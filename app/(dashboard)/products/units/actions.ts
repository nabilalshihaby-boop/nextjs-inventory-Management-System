"use server";

import { db } from "@/lib/db";
import { catalogActions, type CatalogResult } from "@/lib/catalog";

// Product units (OWNER/ADMIN mutations). Shared logic, validation and the local-development upload
// note live in lib/catalog.ts. Images: public/uploads/units.
const actions = catalogActions({
  label: "Unit",
  plural: "units",
  folder: "units",
  path: "/products/units",
  findByName: (name) => db.productUnit.findUnique({ where: { name }, select: { id: true } }),
  findById: (id) => db.productUnit.findUnique({ where: { id }, select: { id: true, image: true } }),
  findNameClash: (name, exceptId) => db.productUnit.findFirst({ where: { name, NOT: { id: exceptId } }, select: { id: true } }),
  create: (data) => db.productUnit.create({ data }),
  update: (id, data) => db.productUnit.update({ where: { id }, data }),
  remove: (id) => db.productUnit.delete({ where: { id } }),
  // Products using this unit (as product, sale or purchase unit) block deletion (FKs are RESTRICT too).
  references: async (id) => {
    const n = await db.product.count({ where: { OR: [{ productUnitId: id }, { saleUnitId: id }, { purchaseUnitId: id }] } });
    return n ? [`${n} product${n === 1 ? "" : "s"}`] : [];
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
