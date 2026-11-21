import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageSales } from "@/lib/roles";
import { getDefaultCurrency } from "@/lib/settings";
import { getSaleRows } from "@/lib/sale-data";
import { getDict } from "@/lib/i18n/server";
import SalesTable from "@/components/sales/SalesTable";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).nav.sales };
}

export const instant = false;

// Sales list (design/Sales.html). OWNER/ADMIN only — USER is redirected before anything is read.
export default async function SalesPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageSales(session.user.role)) redirect("/dashboard");

  const [rows, customers, currency] = await Promise.all([getSaleRows(), db.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }), getDefaultCurrency()]);
  return <SalesTable rows={rows} customers={customers} currency={currency ? { code: currency.code, symbol: currency.symbol, right: currency.right } : null} />;
}
