import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageCatalog } from "@/lib/roles";
import { getDict } from "@/lib/i18n/server";
import CatalogTable from "@/components/products/CatalogTable";
import { createUnit, deleteUnit, setUnitActive, updateUnit } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).catalog.unit.title };
}

export const instant = false;

// Base Units: the MASTER list of reusable units (Piece, Kilogram, Meter, Carton ...), never a product list. Each product picks exactly one
// as its Base Unit; its other units are product-specific conversions edited on the product (see /products/unit-conversions for the
// product-wide overview). Every signed-in role with catalog access may view; only OWNER/ADMIN/catalog.manage get the management controls
// (and every Server Action re-checks that).
export default async function BaseUnitsPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const units = await db.productUnit.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, image: true, active: true, _count: { select: { productsAsUnit: true, conversions: { where: { isBase: false } } } } },
  });
  const rows = units.map((u) => ({ id: u.id, name: u.name, image: u.image, active: u.active, baseUses: u._count.productsAsUnit, packUses: u._count.conversions }));

  return (
    <CatalogTable
      rows={rows}
      canManage={canManageCatalog(session.user)}
      idPrefix="un"
      entity="unit"
      actions={{ create: createUnit, update: updateUnit, remove: deleteUnit }}
      master={{ setActive: setUnitActive }}
    />
  );
}
