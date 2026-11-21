// Shared server logic for simple catalog entities (name + optional image): product categories,
// brands, units. Used from each entity's "use server" actions file.
//
// Images use the shared upload helper: content-validated JPG/PNG/WebP up to 2 MB, random file
// names under public/uploads/<folder>, only the relative path stored in MySQL.
// LOCAL DEVELOPMENT ONLY: files written to public/ at runtime are not served by `next start` and
// may not persist — production needs persistent object storage (see lib/image-upload.ts).
// Messages are dictionary text (getDict) so they follow the signed-in user's language.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { canManageCatalog } from "@/lib/roles";
import { deleteImage, saveImage, validateImage, type ValidImage } from "@/lib/image-upload";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";

export type CatalogField = "name" | "image";
export type CatalogResult =
  | { ok: true; message: string }
  | { ok: false; message: string; fieldErrors?: Partial<Record<CatalogField, string>> };

type Row = { id: string; image: string | null };

export type CatalogEntity = "category" | "brand" | "unit";

export type CatalogConfig = {
  /** Which dictionary entry (`catalog.<entity>`) names this entity in messages. */
  entity: CatalogEntity;
  /** Upload folder under public/uploads. */
  folder: string;
  /** List route to revalidate. */
  path: string;
  /** Data access for this entity (one Prisma delegate). */
  findByName: (name: string) => Promise<{ id: string } | null>;
  findById: (id: string) => Promise<Row | null>;
  findNameClash: (name: string, exceptId: string) => Promise<{ id: string } | null>;
  create: (data: { name: string; image: string | null }) => Promise<unknown>;
  update: (id: string, data: { name: string; image?: string | null }) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  /** Number of products using this record (they block deletion; the FK is RESTRICT as well). */
  references: (id: string) => Promise<number>;
};

const idSchema = z.string().trim().min(1).max(64);
const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const isReferenceViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2003" || e.code === "P2014");

const imageMessage = (t: Dictionary, key: "type" | "size" | "invalid" | undefined, fallback: string) => (key ? t.catalog.img[key] : fallback);

export function catalogActions(c: CatalogConfig) {
  /** OWNER/ADMIN only — re-checked in every mutation; the role never comes from the client. */
  async function authorize(t: Dictionary): Promise<CatalogResult | null> {
    const session = await auth();
    if (!session?.user?.id) return { ok: false, message: t.common.sessionExpired };
    if (!canManageCatalog(session.user.role)) return { ok: false, message: fmt(t.catalog.err.noPermission, { plural: t.catalog[c.entity].plural }) };
    return null;
  }

  /** FormData only: name, optional image file, removeImage flag. */
  async function parseForm(formData: unknown, t: Dictionary) {
    if (!(formData instanceof FormData)) return { ok: false as const, error: { ok: false, message: t.catalog.err.invalidRequest } as CatalogResult };
    const nameSchema = z.string().trim().min(1, t.catalog.val.nameRequired).max(120, t.catalog.val.nameLong);
    const fieldErrors: Partial<Record<CatalogField, string>> = {};
    const rawName = formData.get("name");
    const name = nameSchema.safeParse(typeof rawName === "string" ? rawName : "");
    if (!name.success) fieldErrors.name = name.error.issues[0]?.message ?? t.catalog.val.nameRequired;
    const removeImage = formData.get("removeImage") === "on";
    const file = formData.get("image");
    let image: ValidImage | null = null;
    if (file instanceof File && file.size > 0 && !removeImage) {
      const r = await validateImage(file);
      if ("error" in r) fieldErrors.image = imageMessage(t, r.key, r.error);
      else image = r;
    }
    if (!name.success || Object.keys(fieldErrors).length) {
      return { ok: false as const, error: { ok: false, message: Object.values(fieldErrors)[0] ?? t.common.checkForm, fieldErrors } as CatalogResult };
    }
    return { ok: true as const, name: name.data, image, removeImage };
  }

  async function create(formData: unknown): Promise<CatalogResult> {
    const t = await getDict();
    const N = t.catalog[c.entity];
    const duplicate = fmt(t.catalog.err.duplicate, { one: N.one });
    const denied = await authorize(t);
    if (denied) return denied;
    const p = await parseForm(formData, t);
    if (!p.ok) return p.error;
    // Unique regardless of case (column collation); checked first for a clean message.
    if (await c.findByName(p.name)) return { ok: false, message: duplicate, fieldErrors: { name: duplicate } };
    const image = p.image ? await saveImage(c.folder, p.image) : null;
    try {
      await c.create({ name: p.name, image });
    } catch (e) {
      await deleteImage(c.folder, image);
      if (isUniqueViolation(e)) return { ok: false, message: duplicate, fieldErrors: { name: duplicate } };
      throw e;
    }
    revalidatePath(c.path);
    return { ok: true, message: fmt(t.catalog.ok.created, { label: N.label }) };
  }

  async function update(id: unknown, formData: unknown): Promise<CatalogResult> {
    const t = await getDict();
    const N = t.catalog[c.entity];
    const duplicate = fmt(t.catalog.err.duplicate, { one: N.one });
    const notFound = fmt(t.catalog.err.notFound, { label: N.label });
    const denied = await authorize(t);
    if (denied) return denied;
    const rid = idSchema.safeParse(id);
    if (!rid.success) return { ok: false, message: notFound };
    const p = await parseForm(formData, t);
    if (!p.ok) return p.error;
    // The id only selects the row; it is looked up server-side before anything changes.
    const existing = await c.findById(rid.data);
    if (!existing) return { ok: false, message: notFound };
    if (await c.findNameClash(p.name, existing.id)) return { ok: false, message: duplicate, fieldErrors: { name: duplicate } };

    const newImage = p.image ? await saveImage(c.folder, p.image) : p.removeImage ? null : undefined; // undefined = keep
    try {
      await c.update(existing.id, { name: p.name, ...(newImage !== undefined ? { image: newImage } : {}) });
    } catch (e) {
      if (newImage) await deleteImage(c.folder, newImage);
      if (isUniqueViolation(e)) return { ok: false, message: duplicate, fieldErrors: { name: duplicate } };
      throw e;
    }
    if (newImage !== undefined && existing.image !== newImage) await deleteImage(c.folder, existing.image); // replaced/removed
    revalidatePath(c.path);
    return { ok: true, message: fmt(t.catalog.ok.updated, { label: N.label }) };
  }

  async function remove(id: unknown): Promise<CatalogResult> {
    const t = await getDict();
    const N = t.catalog[c.entity];
    const notFound = fmt(t.catalog.err.notFound, { label: N.label });
    const denied = await authorize(t);
    if (denied) return denied;
    const rid = idSchema.safeParse(id);
    if (!rid.success) return { ok: false, message: notFound };
    const existing = await c.findById(rid.data);
    if (!existing) return { ok: false, message: notFound };

    const products = await c.references(existing.id);
    if (products) {
      const list = fmt(products === 1 ? t.catalog.err.productOne : t.catalog.err.productMany, { n: products });
      return { ok: false, message: fmt(t.catalog.err.blockers, { one: N.one, list }) };
    }
    try {
      await c.remove(existing.id);
    } catch (e) {
      if (isReferenceViolation(e)) return { ok: false, message: fmt(t.catalog.err.inUse, { one: N.one }) };
      throw e;
    }
    await deleteImage(c.folder, existing.image);
    revalidatePath(c.path);
    return { ok: true, message: fmt(t.catalog.ok.deleted, { label: N.label }) };
  }

  return { create, update, remove };
}
