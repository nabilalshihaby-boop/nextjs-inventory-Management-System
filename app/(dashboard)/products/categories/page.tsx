import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageCatalog } from "@/lib/roles";
import CatalogTable from "@/components/products/CatalogTable";
import { createCategory, deleteCategory, updateCategory } from "./actions";

export const metadata: Metadata = { title: "Product Categories" };

export const instant = false;

// Product Categories (design/Product Categories.html). Every signed-in role may view;
// only OWNER/ADMIN get create/edit/delete (and the Server Actions re-check that).
export default async function ProductCategoriesPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const rows = await db.productCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, image: true } });

  return (
    <CatalogTable
      rows={rows}
      canManage={canManageCatalog(session.user.role)}
      idPrefix="pc"
      labels={{
        column: "Product Category",
        create: "Create Product Category",
        edit: "Edit Product Category",
        itemType: "product category",
        plural: "product categories",
        empty: "No product categories yet",
        imageLabel: "Category Image",
      }}
      actions={{ create: createCategory, update: updateCategory, remove: deleteCategory }}
    />
  );
}
