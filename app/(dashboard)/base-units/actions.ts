"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageCatalog } from "@/lib/roles";
import { catalogActions, type CatalogResult } from "@/lib/catalog";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";

// Base Units master (the reusable unit list: Piece, Kilogram, Meter, Carton ...). Mutations need OWNER/ADMIN or catalog.manage and are
// re-checked here on every call. Shared validation, uploads and messages live in lib/catalog.ts (images: public/uploads/units).
// A unit's per-product factors are NOT stored here: they belong to each product's unit conversions.
const actions = catalogActions({
  entity: "unit",
  folder: "units",
  path: "/base-units",
  findByName: (name) => db.productUnit.findUnique({ where: { name }, select: { id: true } }),
  findById: (id) => db.productUnit.findUnique({ where: { id }, select: { id: true, image: true } }),
  findNameClash: (name, exceptId) => db.productUnit.findFirst({ where: { name, NOT: { id: exceptId } }, select: { id: true } }),
  create: (data) => db.productUnit.create({ data }),
  update: (id, data) => db.productUnit.update({ where: { id }, data }),
  remove: (id) => db.productUnit.delete({ where: { id } }),
  // Products using this unit (as base, sale or purchase unit, or as a pack unit) block deletion (FKs are RESTRICT too).
  references: async (id) => {
    const n = await db.product.count({ where: { OR: [{ productUnitId: id }, { saleUnitId: id }, { purchaseUnitId: id }] } });
    // A unit that any product lists as one of its pack units (conversion rows) can't be deleted either; document
    // lines keep the unit id/name snapshot, and a used conversion row can never be removed (see lib/product-units.ts).
    const packs = await db.productUnitConversion.count({ where: { unitId: id, product: { NOT: { OR: [{ productUnitId: id }, { saleUnitId: id }, { purchaseUnitId: id }] } } } });
    return n + packs;
  },
});

export async function createUnit(formData: FormData): Promise<CatalogResult> {
  return actions.create(formData);
}
export async function updateUnit(id: string, formData: FormData): Promise<CatalogResult> {
  return actions.update(id, formData);
}
export async function deleteUnit(id: string): Promise<CatalogResult> {
  return actions.remove(id);
}

/**
 * Activate / deactivate a Base Unit. Deactivating never touches products, conversions or documents: the unit stays visible wherever it is
 * already used and only stops being offered for NEW product setup (the product actions enforce that again). Idempotent, so two concurrent
 * toggles can't corrupt anything: the last one wins.
 */
export async function setUnitActive(id: unknown, active: unknown): Promise<CatalogResult> {
  const t = await getDict();
  const M = t.units.master;
  const session = await auth();
  if (!session?.user?.id) return { ok: false, message: t.common.sessionExpired };
  if (!canManageCatalog(session.user)) return { ok: false, message: M.err.noPermission };
  if (typeof id !== "string" || !id.trim() || id.length > 64 || typeof active !== "boolean") return { ok: false, message: M.err.invalidRequest };
  const found = await db.productUnit.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!found) return { ok: false, message: M.err.notFound };
  await db.productUnit.update({ where: { id: found.id }, data: { active } });
  revalidatePath("/base-units");
  return { ok: true, message: fmt(active ? M.ok.activated : M.ok.deactivated, { name: found.name }) };
}
