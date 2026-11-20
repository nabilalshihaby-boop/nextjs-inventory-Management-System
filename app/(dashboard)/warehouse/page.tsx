import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getCountryOptions } from "@/lib/countries";
import { formatDateTime } from "@/lib/format";
import { canManageWarehouses } from "@/lib/roles";
import { getSystemSettings } from "@/lib/settings";
import WarehouseTable from "@/components/warehouse/WarehouseTable";

export const metadata: Metadata = { title: "Warehouse" };

export const instant = false;

// Warehouse list (design/Warehouse.html). Every signed-in role may view, search and open the
// details modal; only OWNER/ADMIN get create/edit/delete (and the Server Actions re-check that).
export default async function WarehousePage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const [warehouses, settings] = await Promise.all([
    db.warehouse.findMany({ orderBy: { createdAt: "desc" } }),
    getSystemSettings(),
  ]);
  const countryName = new Map(getCountryOptions().map((c) => [c.code, c.name]));

  const rows = warehouses.map((w) => ({
    id: w.id,
    name: w.name,
    email: w.email,
    phoneNumber: w.phoneNumber,
    countryCode: w.countryCode,
    countryName: countryName.get(w.countryCode as never) ?? w.countryCode,
    city: w.city,
    zipCode: w.zipCode ?? "",
    createdOn: formatDateTime(w.createdAt, settings?.dateFormat),
  }));

  return <WarehouseTable rows={rows} canManage={canManageWarehouses(session.user.role)} />;
}
