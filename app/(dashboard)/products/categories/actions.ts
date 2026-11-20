"use server";

import { db } from "@/lib/db";
import { catalogActions, type CatalogResult } from "@/lib/catalog";

// Product categories (OWNER/ADMIN mutations). Shared logic, validation and the local-development
// upload note live in lib/catalog.ts. Images: public/uploads/product-categories.
const actions = catalogActions({
  label: "Product category",
  plural: "product categories",
  folder: "product-categories",
  path: "/products/categories",
  findByName: (name) => db.productCategory.findUnique({ where: { name }, select: { id: true } }),
  findById: (id) => db.productCategory.findUnique({ where: { id }, select: { id: true, image: true } }),
  findNameClash: (name, exceptId) => db.productCategory.findFirst({ where: { name, NOT: { id: exceptId } }, select: { id: true } }),
  create: (data) => db.productCategory.create({ data }),
  update: (id, data) => db.productCategory.update({ where: { id }, data }),
  remove: (id) => db.productCategory.delete({ where: { id } }),
  // Products using this category block deletion (the FK is RESTRICT as well).
  references: async (id) => {
    const n = await db.product.count({ where: { categoryId: id } });
    return n ? [`${n} product${n === 1 ? "" : "s"}`] : [];
  },
});

export async function createCategory(formData: FormData): Promise<CatalogResult> {
  return actions.create(formData);
}
export async function updateCategory(id: string, formData: FormData): Promise<CatalogResult> {
  return actions.update(id, formData);
}
export async function deleteCategory(id: string): Promise<CatalogResult> {
  return actions.remove(id);
}
