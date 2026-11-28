import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageProducts } from "@/lib/roles";
import { dimensionsOf, type FamilyRow } from "@/lib/family-core";
import { getDict } from "@/lib/i18n/server";
import FamiliesTable from "@/components/products/FamiliesTable";
import { createFamily, deleteFamily, updateFamily } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).families.title };
}

export const instant = false;

// Product Families: an optional grouping layer over products (variants of one product). Reachable only with products.manage (the proxy
// gate and this page both check it; every Server Action re-checks it). It never shows cost, price or stock.
export default async function FamiliesPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageProducts(session.user)) redirect("/products");

  const families = await db.productFamily.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, handle: true, hsCode: true, dimension1: true, dimension2: true, dimension3: true, _count: { select: { products: true } } },
  });
  const rows: FamilyRow[] = families.map((f) => ({ id: f.id, name: f.name, handle: f.handle, hsCode: f.hsCode, dimensions: dimensionsOf(f), products: f._count.products }));

  return <FamiliesTable rows={rows} actions={{ create: createFamily, update: updateFamily, remove: deleteFamily }} />;
}
