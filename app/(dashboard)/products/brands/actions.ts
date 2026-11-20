"use server";

import { db } from "@/lib/db";
import { catalogActions, type CatalogResult } from "@/lib/catalog";

// Brands (OWNER/ADMIN mutations). Shared logic, validation and the local-development upload note
// live in lib/catalog.ts. Images: public/uploads/brands.
const actions = catalogActions({
  label: "Brand",
  plural: "brands",
  folder: "brands",
  path: "/products/brands",
  findByName: (name) => db.brand.findUnique({ where: { name }, select: { id: true } }),
  findById: (id) => db.brand.findUnique({ where: { id }, select: { id: true, image: true } }),
  findNameClash: (name, exceptId) => db.brand.findFirst({ where: { name, NOT: { id: exceptId } }, select: { id: true } }),
  create: (data) => db.brand.create({ data }),
  update: (id, data) => db.brand.update({ where: { id }, data }),
  remove: (id) => db.brand.delete({ where: { id } }),
  // Products using this brand block deletion (the FK is RESTRICT as well).
  references: async (id) => {
    const n = await db.product.count({ where: { brandId: id } });
    return n ? [`${n} product${n === 1 ? "" : "s"}`] : [];
  },
});

export async function createBrand(formData: FormData): Promise<CatalogResult> {
  return actions.create(formData);
}
export async function updateBrand(id: string, formData: FormData): Promise<CatalogResult> {
  return actions.update(id, formData);
}
export async function deleteBrand(id: string): Promise<CatalogResult> {
  return actions.remove(id);
}
