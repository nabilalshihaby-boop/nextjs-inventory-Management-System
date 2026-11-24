import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageProducts } from "@/lib/roles";
import { getDict } from "@/lib/i18n/server";
import { trimFactor } from "@/lib/unit-math";
import BaseUnitsTable, { type BaseUnitRow } from "@/components/products/BaseUnitsTable";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).units.page.title };
}

export const instant = false;

// Base Units: every product's base unit (stock is always counted in it) and its pack units with their factors.
// A product-specific view of the Unit master — units themselves are created in Units, factors are edited on the
// product. Every signed-in role may view (like Products); only OWNER/ADMIN get the edit links.
export default async function BaseUnitsPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const products = await db.product.findMany({
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true, productUnit: { select: { name: true } }, unitConversions: { where: { isBase: false }, orderBy: { createdAt: "asc" }, select: { factor: true, active: true, unit: { select: { name: true } } } } },
  });
  const rows: BaseUnitRow[] = products.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    base: p.productUnit.name,
    packs: p.unitConversions.map((c) => ({ unit: c.unit.name, factor: trimFactor(c.factor.toFixed(6)), active: c.active })),
  }));
  return <BaseUnitsTable rows={rows} canManage={canManageProducts(session.user)} />;
}
