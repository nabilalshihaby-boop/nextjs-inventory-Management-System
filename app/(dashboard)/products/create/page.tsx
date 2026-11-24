import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { canManageProducts } from "@/lib/roles";
import { getProductFormData } from "@/lib/product-options";
import { getDict } from "@/lib/i18n/server";
import ProductForm from "@/components/products/ProductForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).products.createTitle };
}

export const instant = false;

// Create Product (design/Create Product.html). OWNER/ADMIN only; USER goes back to the list.
export default async function CreateProductPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageProducts(session.user)) redirect("/products");

  const data = await getProductFormData();
  return <ProductForm {...data} />;
}
