import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageCatalog } from "@/lib/roles";
import { getDict } from "@/lib/i18n/server";
import CatalogTable from "@/components/products/CatalogTable";
import { createUnit, deleteUnit, updateUnit } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).catalog.unit.title };
}

export const instant = false;

// Units (design/Units.html). Every signed-in role may view; only OWNER/ADMIN get
// create/edit/delete (and the Server Actions re-check that).
export default async function UnitsPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const rows = await db.productUnit.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, image: true } });

  return (
    <CatalogTable
      rows={rows}
      canManage={canManageCatalog(session.user)}
      idPrefix="un"
      entity="unit"
      actions={{ create: createUnit, update: updateUnit, remove: deleteUnit }}
    />
  );
}
