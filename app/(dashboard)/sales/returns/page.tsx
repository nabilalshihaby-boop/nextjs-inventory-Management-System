import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageSaleReturns, canViewSaleReturns } from "@/lib/roles";
import { getDefaultCurrency } from "@/lib/settings";
import { getSaleReturnRows } from "@/lib/sale-return-data";
import { getDict } from "@/lib/i18n/server";
import SaleReturnsTable from "@/components/sales/SaleReturnsTable";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).nav.s2 };
}

export const instant = false;

// Sales Returns list (design/Sales Returns.html). OWNER/ADMIN only — USER is redirected before
// anything is read. Amounts are the stored server-computed snapshots.
export default async function SaleReturnsPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canViewSaleReturns(session.user)) redirect("/dashboard");

  const [rows, customers, currency] = await Promise.all([getSaleReturnRows(), db.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }), getDefaultCurrency()]);
  return <SaleReturnsTable canManage={canManageSaleReturns(session.user)} rows={rows} customers={customers} currency={currency ? { code: currency.code, symbol: currency.symbol, right: currency.right } : null} />;
}
