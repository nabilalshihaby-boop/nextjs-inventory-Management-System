import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { canManageProducts } from "@/lib/roles";
import { getProductFormData } from "@/lib/product-options";
import ProductForm from "@/components/products/ProductForm";

export const metadata: Metadata = { title: "Create Product" };

export const instant = false;

// Create Product (design/Create Product.html). OWNER/ADMIN only; USER goes back to the list.
export default async function CreateProductPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageProducts(session.user.role)) redirect("/products");

  const data = await getProductFormData();
  return <ProductForm {...data} />;
}
