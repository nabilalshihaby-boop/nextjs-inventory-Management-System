import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageProducts, canViewProducts } from "@/lib/roles";
import { getDict } from "@/lib/i18n/server";
import { trimFactor } from "@/lib/unit-math";
import ProductUnitConversionsTable, { type ProductUnitConversionRow } from "@/components/products/ProductUnitConversionsTable";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).units.page.title };
}

export const instant = false;

// Product Unit Conversions: the products that have Product Units beyond their Base Unit, with each factor ("1 Box = 6 Piece") and the default
// sale / purchase units. A product-specific view of the Base Units master: factors are edited on the product ("Manage Units" opens its edit
// form). Every signed-in role with products access may view; only product managers get the action. The list is filtered client-side
// (default: products with extra units only; a toggle also shows Base Unit only products).
export default async function ProductUnitConversionsPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  // Lists product names, SKUs and their units: product viewing is required, and checked before anything is read.
  if (!canViewProducts(session.user)) redirect("/dashboard");

  const products = await db.product.findMany({
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true, productUnit: { select: { name: true } }, saleUnit: { select: { name: true } }, purchaseUnit: { select: { name: true } }, unitConversions: { where: { isBase: false }, orderBy: { createdAt: "asc" }, select: { factor: true, active: true, unit: { select: { name: true } } } } },
  });
  const rows: ProductUnitConversionRow[] = products.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    base: p.productUnit.name,
    saleUnit: p.saleUnit.name,
    purchaseUnit: p.purchaseUnit.name,
    packs: p.unitConversions.map((c) => ({ unit: c.unit.name, factor: trimFactor(c.factor.toFixed(6)), active: c.active })),
  }));
  return <ProductUnitConversionsTable rows={rows} canManage={canManageProducts(session.user)} />;
}
