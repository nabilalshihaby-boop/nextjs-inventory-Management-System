"use server";

import { db } from "@/lib/db";
import { catalogActions, type CatalogResult } from "@/lib/catalog";

// Product units (OWNER/ADMIN mutations). Shared logic, validation and the local-development upload
// note live in lib/catalog.ts. Images: public/uploads/units.
const actions = catalogActions({
  entity: "unit",
  folder: "units",
  path: "/products/units",
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
