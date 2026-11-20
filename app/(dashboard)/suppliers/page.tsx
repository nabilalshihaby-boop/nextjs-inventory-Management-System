import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getCountryOptions } from "@/lib/countries";
import { formatDateTime } from "@/lib/format";
import { canManageSuppliers, canViewSupplierStatement } from "@/lib/roles";
import { getSystemSettings } from "@/lib/settings";
import SuppliersTable from "@/components/suppliers/SuppliersTable";

export const metadata: Metadata = { title: "Suppliers" };

export const instant = false;

// Suppliers list (design/Suppliers.html). Every signed-in role may view/search; only OWNER/ADMIN
// get create/edit/delete/import controls (and the Server Actions re-check that).
export default async function SuppliersPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const [suppliers, settings] = await Promise.all([db.supplier.findMany({ orderBy: { createdAt: "desc" } }), getSystemSettings()]);
  const countryName = new Map<string, string>(getCountryOptions().map((c) => [c.code, c.name]));

  const rows = suppliers.map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    phoneNumber: s.phoneNumber,
    countryName: countryName.get(s.countryCode) ?? s.countryCode,
    city: s.city,
    createdOn: formatDateTime(s.createdAt, settings?.dateFormat),
  }));

  return <SuppliersTable rows={rows} canManage={canManageSuppliers(session.user.role)} canViewStatement={canViewSupplierStatement(session.user.role)} />;
}
