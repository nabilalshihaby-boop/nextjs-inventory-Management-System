import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getCountryOptions } from "@/lib/countries";
import { formatDateTime } from "@/lib/format";
import { canManageCustomers, canViewCustomerStatement } from "@/lib/roles";
import { getSystemSettings } from "@/lib/settings";
import type { CustomerRow } from "@/lib/customers";
import { getDict, getLocale } from "@/lib/i18n/server";
import CustomersTable from "@/components/customers/CustomersTable";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).nav.pe2 };
}

export const instant = false;

// Customers list (design/Customers.html). Every signed-in role may view/search; only OWNER/ADMIN
// get create/edit/delete/import controls (and the Server Actions re-check that).
export default async function CustomersPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const locale = await getLocale();
  const [customers, settings] = await Promise.all([db.customer.findMany({ orderBy: { createdAt: "desc" } }), getSystemSettings()]);
  const countryName = new Map<string, string>(getCountryOptions(locale).map((c) => [c.code, c.name]));

  const rows: CustomerRow[] = customers.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phoneNumber: c.phoneNumber,
    countryName: countryName.get(c.countryCode) ?? c.countryCode,
    city: c.city,
    createdOn: formatDateTime(c.createdAt, settings?.dateFormat, locale),
  }));

  return <CustomersTable rows={rows} canManage={canManageCustomers(session.user)} canViewStatement={canViewCustomerStatement(session.user)} />;
}
