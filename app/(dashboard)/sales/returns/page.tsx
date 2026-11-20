import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageSaleReturns } from "@/lib/roles";
import { getDefaultCurrency } from "@/lib/settings";
import { getSaleReturnRows } from "@/lib/sale-return-data";
import SaleReturnsTable from "@/components/sales/SaleReturnsTable";

export const metadata: Metadata = { title: "Sales Returns" };

export const instant = false;

// Sales Returns list (design/Sales Returns.html). OWNER/ADMIN only — USER is redirected before
// anything is read. Amounts are the stored server-computed snapshots.
export default async function SaleReturnsPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageSaleReturns(session.user.role)) redirect("/dashboard");

  const [rows, customers, currency] = await Promise.all([getSaleReturnRows(), db.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }), getDefaultCurrency()]);
  return <SaleReturnsTable rows={rows} customers={customers} currency={currency ? { code: currency.code, symbol: currency.symbol, right: currency.right } : null} />;
}
