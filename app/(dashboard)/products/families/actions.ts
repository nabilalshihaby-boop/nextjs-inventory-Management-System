"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { canManageProducts } from "@/lib/roles";
import { fmt } from "@/lib/i18n/config";
import { getDict } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n";
import { DIMENSION_NAME_MAX, FAMILY_NAME_MAX, HANDLE_MAX, MAX_DIMENSIONS, cleanText, compareKey, dimensionsOf, handleKeyOf, handleProblem, hasControlChars } from "@/lib/family-core";
import { FamilyHandleTaken, FamilyNameTaken, createFamilyRecord, familyUniqueTarget, lockFamily } from "@/lib/product-families";
import { withDeadlockRetry } from "@/lib/product-identifiers";

// Product Families (create / edit / delete). `products.manage` (OWNER, ADMIN, or a USER whose role grants it) is re-checked in EVERY
// mutation; nothing comes from the client but the plain fields below. Any other field, a repeated field or a non-string value refuses
// the whole request before anything is written. A family that has members can't be deleted, and its dimensions are frozen (they give
// meaning to its members' values) — the display name stays editable. Both rules are decided inside a transaction that locks the family
// row, which is the same row a product write locks, so they hold against concurrent product saves.

export type FamilyField = "name" | "dimensions" | "handle";
export type FamilyResult = { ok: true; message: string } | { ok: false; message: string; fieldErrors?: Partial<Record<FamilyField, string>> };

const ALLOWED = new Set(["name", "handle", "dimension1", "dimension2", "dimension3"]);
const idOk = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64 && !hasControlChars(v);
const fail = (message: string, fieldErrors?: Partial<Record<FamilyField, string>>): FamilyResult => ({ ok: false, message, fieldErrors });

async function authorize(t: Dictionary): Promise<{ error: FamilyResult } | { ok: true }> {
  const session = await auth();
  if (!session?.user?.id) return { error: fail(t.common.sessionExpired) };
  if (!canManageProducts(session.user)) return { error: fail(t.families.err.noPermission) };
  return { ok: true };
}

/** handle: undefined = the request did not send one (create: generate; update: keep the stored one). */
type Parsed = { name: string; dims: string[]; handle?: string };

/** Strictly reads and validates the family fields; no database access. */
function parse(fd: unknown, t: Dictionary): { ok: true; data: Parsed } | { ok: false; result: FamilyResult } {
  const V = t.families.val;
  if (!(fd instanceof FormData)) return { ok: false, result: fail(t.families.err.invalidRequest) };
  const keys = [...fd.keys()];
  if (keys.some((k) => !ALLOWED.has(k)) || new Set(keys).size !== keys.length) return { ok: false, result: fail(t.families.err.unexpectedFields) };
  const read = (k: string): string | null => {
    const v = fd.get(k);
    return v === null ? "" : typeof v === "string" ? v : null;
  };
  const rawName = read("name");
  const rawHandle = fd.has("handle") ? read("handle") : undefined;
  const rawDims = [read("dimension1"), read("dimension2"), read("dimension3")];
  if (rawName === null || rawHandle === null || rawDims.some((d) => d === null)) return { ok: false, result: fail(t.families.err.invalidRequest) };

  if (hasControlChars(rawName)) return { ok: false, result: fail(V.nameChars, { name: V.nameChars }) };
  const name = cleanText(rawName);
  if (!name) return { ok: false, result: fail(V.nameRequired, { name: V.nameRequired }) };
  if (name.length > FAMILY_NAME_MAX) {
    const m = fmt(V.nameLong, { max: FAMILY_NAME_MAX });
    return { ok: false, result: fail(m, { name: m }) };
  }
  const dims: string[] = [];
  let gap = false;
  for (const raw of rawDims as string[]) {
    if (hasControlChars(raw)) return { ok: false, result: fail(V.dimChars, { dimensions: V.dimChars }) };
    const d = cleanText(raw);
    if (!d) {
      gap = true;
      continue;
    }
    if (gap) return { ok: false, result: fail(V.dimOrder, { dimensions: V.dimOrder }) };
    if (d.length > DIMENSION_NAME_MAX) {
      const m = fmt(V.dimLong, { max: DIMENSION_NAME_MAX });
      return { ok: false, result: fail(m, { dimensions: m }) };
    }
    dims.push(d);
  }
  if (dims.length > MAX_DIMENSIONS) return { ok: false, result: fail(fmt(V.dimTooMany, { max: MAX_DIMENSIONS })) };
  if (new Set(dims.map(compareKey)).size !== dims.length) return { ok: false, result: fail(V.dimDuplicate, { dimensions: V.dimDuplicate }) };
  // Handle: optional key; when sent it must be a non-blank, strictly valid handle (typed input is trimmed and lowercased).
  let handle: string | undefined;
  if (rawHandle !== undefined) {
    handle = rawHandle.trim().toLowerCase();
    const problem = hasControlChars(rawHandle) ? "format" : handleProblem(handle);
    if (problem) {
      const m = problem === "required" ? V.handleRequired : problem === "long" ? fmt(V.handleLong, { max: HANDLE_MAX }) : V.handleFormat;
      return { ok: false, result: fail(m, { handle: m }) };
    }
  }
  return { ok: true, data: { name, dims, handle } };
}

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const columns = (d: Parsed) => ({ name: d.name, dimension1: d.dims[0] ?? null, dimension2: d.dims[1] ?? null, dimension3: d.dims[2] ?? null });
const dupHandle = (t: Dictionary) => fail(t.families.err.duplicateHandle, { handle: t.families.err.duplicateHandle });

/** Thrown inside a transaction to roll back and report a business-rule refusal. */
class Refusal extends Error {
  constructor(readonly result: FamilyResult) {
    super("refused");
  }
}

export async function createFamily(formData: FormData): Promise<FamilyResult> {
  const t = await getDict();
  const a = await authorize(t);
  if ("error" in a) return a.error;
  const p = parse(formData, t);
  if (!p.ok) return p.result;
  try {
    await createFamilyRecord({ name: p.data.name, dims: p.data.dims, handle: p.data.handle });
  } catch (e) {
    if (e instanceof FamilyNameTaken) return fail(t.families.err.duplicateName, { name: t.families.err.duplicateName });
    if (e instanceof FamilyHandleTaken) return dupHandle(t);
    throw e;
  }
  revalidatePath("/products/families");
  return { ok: true, message: t.families.ok.created };
}

export async function updateFamily(id: unknown, formData: FormData): Promise<FamilyResult> {
  const t = await getDict();
  const a = await authorize(t);
  if ("error" in a) return a.error;
  if (!idOk(id)) return fail(t.families.err.notFound);
  const p = parse(formData, t);
  if (!p.ok) return p.result;
  try {
    await withDeadlockRetry(() =>
      db.$transaction(async (tx) => {
        const fam = await lockFamily(tx, id); // serializes with product writes into this family
        if (!fam) throw new Refusal(fail(t.families.err.notFound));
        const members = await tx.product.count({ where: { familyId: id } });
        const same = dimensionsOf(fam).join("\u001f") === p.data.dims.join("\u001f");
        if (members > 0 && !same) throw new Refusal(fail(fmt(t.families.err.dimsLocked, { n: members }), { dimensions: fmt(t.families.err.dimsLocked, { n: members }) }));
        // The handle changes ONLY when the request explicitly carries a different one; renaming never touches it.
        const handleData = p.data.handle !== undefined && handleKeyOf(p.data.handle) !== handleKeyOf(fam.handle) ? { handle: p.data.handle, handleKey: handleKeyOf(p.data.handle) } : {};
        await tx.productFamily.update({ where: { id }, data: { ...(members > 0 ? { name: p.data.name } : columns(p.data)), ...handleData } });
      }),
    );
  } catch (e) {
    if (e instanceof Refusal) return e.result;
    const target = familyUniqueTarget(e);
    if (target === "handle") return dupHandle(t);
    if (target === "name" || isUnique(e)) return fail(t.families.err.duplicateName, { name: t.families.err.duplicateName });
    throw e;
  }
  revalidatePath("/products/families");
  revalidatePath("/products");
  return { ok: true, message: t.families.ok.updated };
}

export async function deleteFamily(id: unknown): Promise<FamilyResult> {
  const t = await getDict();
  const a = await authorize(t);
  if ("error" in a) return a.error;
  if (!idOk(id)) return fail(t.families.err.notFound);
  try {
    await withDeadlockRetry(() =>
      db.$transaction(async (tx) => {
        const fam = await lockFamily(tx, id);
        if (!fam) throw new Refusal(fail(t.families.err.notFound));
        const members = await tx.product.count({ where: { familyId: id } });
        if (members > 0) throw new Refusal(fail(fmt(t.families.err.inUse, { n: members })));
        await tx.productFamily.delete({ where: { id } });
      }),
    );
  } catch (e) {
    if (e instanceof Refusal) return e.result;
    // The foreign key is RESTRICT: a product that joined at the last moment still blocks the delete.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") return fail(fmt(t.families.err.inUse, { n: 1 }));
    throw e;
  }
  revalidatePath("/products/families");
  return { ok: true, message: t.families.ok.deleted };
}
