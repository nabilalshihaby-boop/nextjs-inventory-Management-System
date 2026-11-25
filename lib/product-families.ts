import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { fmt } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";
import { DIMENSION_NAME_MAX, VARIANT_VALUE_MAX, handleKeyOf, nextFreeHandle, slugifyHandle, cleanText, describeVariant, dimensionsOf, hasControlChars, variantColumns, type FamilyDims, type VariantValues } from "@/lib/family-core";

// SERVER-ONLY: how a product's family and variant values are read from a request, checked and written.
//
// Rules (all enforced here, on the server, never trusted from the form):
//  - a product has no family (standalone) or exactly one existing family;
//  - a member gives ONE non-empty value for every dimension the family has configured and NO value for the others;
//  - the combination is unique inside the family: checked first for a friendly message, and guaranteed by the database unique index
//    on (familyId, variantKey) even when two requests race;
//  - while a product is being written the family row is locked (SELECT ... FOR UPDATE), so a concurrent change of the family's
//    dimensions can't reinterpret the values being saved (and the family editor locks the same row to count members).
// Request keys: `familyId`, `variantValue1`, `variantValue2`, `variantValue3`. Any other key that looks family-related is refused.

export const FAMILY_KEYS = ["familyId", "variantValue1", "variantValue2", "variantValue3"] as const;
const RELATED = /^(family|variant|dimension)/i;
const VALUE_FIELDS = ["variantValue1", "variantValue2", "variantValue3"] as const;

type Client = Prisma.TransactionClient;
export type FamilyMessages = Dictionary["families"]["product"];

/** What a request asks for: `undefined` = it didn't mention a family (leave the stored one alone / standalone on create). */
export type FamilyRequest = { familyId: string; values: string[]; family: { id: string; name: string; dims: string[] } } | { familyId: null; values: [] } | undefined;

export type FamilyParse = { ok: true; request: FamilyRequest } | { ok: false; field: "familyId" | "variantValue1" | "variantValue2" | "variantValue3"; message: string };

/** True when a Prisma error is the unique index on (familyId, variantKey). */
export function isVariantRace(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const target = (e.meta as { target?: unknown } | undefined)?.target;
  return /products_family_variant_key|variantKey/.test(String(Array.isArray(target) ? target.join(",") : (target ?? "")));
}

/** Locks the family row for the rest of the transaction and returns its current dimensions (null when it is gone). */
export async function lockFamily(tx: Client, familyId: string): Promise<(FamilyDims & { id: string; name: string; handle: string }) | null> {
  const rows = await tx.$queryRaw<{ id: string; name: string; handle: string; dimension1: string | null; dimension2: string | null; dimension3: string | null }[]>`
    SELECT id, name, handle, dimension1, dimension2, dimension3 FROM product_families WHERE id = ${familyId} FOR UPDATE`;
  return rows[0] ?? null;
}

/**
 * Reads and validates the family fields of a product request (no writes). `form` is the raw FormData.
 * Unknown family-related keys, variant values for unconfigured dimensions, a family id that doesn't exist, a family without
 * dimensions, and missing / over-long / control-character values are all refused with a localized message.
 */
export async function parseFamilyRequest(form: FormData, M: FamilyMessages): Promise<FamilyParse> {
  const allowed = new Set<string>(FAMILY_KEYS);
  for (const k of new Set(form.keys())) if (RELATED.test(k) && !allowed.has(k)) return { ok: false, field: "familyId", message: M.unexpected };
  const raw = (k: string) => form.getAll(k);
  for (const k of FAMILY_KEYS) if (raw(k).length > 1 || raw(k).some((v) => typeof v !== "string")) return { ok: false, field: "familyId", message: M.unexpected };
  const get = (k: string) => (raw(k)[0] as string | undefined) ?? "";
  const hasFamily = form.has("familyId");
  const anyValue = [1, 2, 3].some((n) => get(`variantValue${n}`).trim() !== "");
  if (!hasFamily) return anyValue ? { ok: false, field: "familyId", message: M.unexpected } : { ok: true, request: undefined };

  const id = get("familyId").trim();
  if (!id) return anyValue ? { ok: false, field: "variantValue1", message: M.unexpected } : { ok: true, request: { familyId: null, values: [] } };
  if (id.length > 64 || hasControlChars(id)) return { ok: false, field: "familyId", message: M.familyInvalid };
  const family = await db.productFamily.findUnique({ where: { id }, select: { id: true, name: true, dimension1: true, dimension2: true, dimension3: true } });
  if (!family) return { ok: false, field: "familyId", message: M.familyInvalid };
  const dims = dimensionsOf(family);
  if (!dims.length) return { ok: false, field: "familyId", message: M.noDimsErr };

  const values: string[] = [];
  for (let i = 0; i < 3; i++) {
    const field = VALUE_FIELDS[i];
    const v = get(field);
    if (i >= dims.length) {
      if (v.trim() !== "") return { ok: false, field, message: M.unexpected }; // a value for a dimension this family doesn't have
      continue;
    }
    if (hasControlChars(v)) return { ok: false, field, message: fmt(M.valueChars, { dimension: dims[i] }) };
    const cleaned = cleanText(v);
    if (!cleaned) return { ok: false, field, message: fmt(M.valueRequired, { dimension: dims[i] }) };
    if (cleaned.length > VARIANT_VALUE_MAX) return { ok: false, field, message: fmt(M.valueLong, { dimension: dims[i], max: VARIANT_VALUE_MAX }) };
    values.push(cleaned);
  }
  return { ok: true, request: { familyId: family.id, values, family: { id: family.id, name: family.name, dims } } };
}

/** Friendly pre-check of the combination (the unique index remains the final guard). Returns the message or null. */
export async function checkVariantFree(req: Exclude<FamilyRequest, undefined>, exceptProductId: string | null, M: FamilyMessages): Promise<string | null> {
  if (!req.familyId) return null;
  const { variantKey } = variantColumns(req.values);
  const clash = await db.product.findFirst({ where: { familyId: req.familyId, variantKey, ...(exceptProductId ? { NOT: { id: exceptProductId } } : {}) }, select: { id: true } });
  return clash ? fmt(M.duplicate, { family: req.family.name, variant: describeVariant(req.family.dims, req.values) }) : null;
}

/** Thrown inside a transaction when the family changed between validation and the write (rolls everything back). */
export class FamilyChanged extends Error {}

/**
 * Inside the product's transaction: locks the family, confirms its dimensions are still the ones the request was validated against,
 * and returns the columns to write. A standalone request returns all-null columns.
 */
export async function familyColumns(tx: Client, req: Exclude<FamilyRequest, undefined>): Promise<{ familyId: string | null } & VariantValues & { variantKey: string | null }> {
  if (!req.familyId) return { familyId: null, ...variantColumns([]) };
  const fam = await lockFamily(tx, req.familyId);
  if (!fam || dimensionsOf(fam).join("\u001f") !== req.family.dims.join("\u001f")) throw new FamilyChanged();
  return { familyId: req.familyId, ...variantColumns(req.values) };
}

export { DIMENSION_NAME_MAX };

// ---------------------------------------------------------------------------------------------
// Creating a family record (the one writer; the Server Action and any future Shopify import both call it)
// ---------------------------------------------------------------------------------------------


export class FamilyNameTaken extends Error {}
export class FamilyHandleTaken extends Error {}

/** Which unique index a P2002 hit: the family name or the handle. */
export function familyUniqueTarget(e: unknown): "name" | "handle" | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return null;
  const target = String((e.meta as { target?: unknown } | undefined)?.target ?? "");
  if (/handleKey/i.test(target)) return "handle";
  if (/name/i.test(target)) return "name";
  return null;
}

/**
 * Creates a family. `handle` omitted = generate one from the name (deterministic slug, ASCII fallback, -2/-3 suffixes when taken; a
 * concurrent claim of the same candidate retries with the next free one). `handle` given = stored EXACTLY as supplied (the caller has
 * validated it; a future Shopify import passes the existing Shopify handle here) and a clash raises FamilyHandleTaken.
 * Existing families keep their handle forever: nothing here is ever called on rename.
 */
export async function createFamilyRecord(input: { name: string; dims: string[]; handle?: string }) {
  const data = { name: input.name, dimension1: input.dims[0] ?? null, dimension2: input.dims[1] ?? null, dimension3: input.dims[2] ?? null };
  if (input.handle !== undefined) {
    try {
      return await db.productFamily.create({ data: { ...data, handle: input.handle, handleKey: handleKeyOf(input.handle) } });
    } catch (e) {
      const t = familyUniqueTarget(e);
      if (t === "handle") throw new FamilyHandleTaken();
      if (t === "name") throw new FamilyNameTaken();
      throw e;
    }
  }
  const base = slugifyHandle(input.name);
  for (let attempt = 0; attempt < 8; attempt++) {
    const rows = await db.productFamily.findMany({ where: { handleKey: { startsWith: base } }, select: { handleKey: true } });
    const handle = nextFreeHandle(base, new Set(rows.map((r) => r.handleKey)));
    try {
      return await db.productFamily.create({ data: { ...data, handle, handleKey: handleKeyOf(handle) } });
    } catch (e) {
      const t = familyUniqueTarget(e);
      if (t === "name") throw new FamilyNameTaken();
      if (t === "handle") continue; // another request just took this candidate: pick the next free one
      throw e;
    }
  }
  throw new FamilyHandleTaken();
}
