import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageQuotations } from "@/lib/roles";
import { getDefaultCurrency } from "@/lib/settings";
import { getQuotationRows } from "@/lib/quotation-data";
import { getDict } from "@/lib/i18n/server";
import QuotationsTable from "@/components/quotations/QuotationsTable";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).quotations.list.title };
}

export const instant = false;

// Quotations list (design/Quotations.html). OWNER/ADMIN only — USER is redirected before anything
// is read. Amounts are the stored server-computed snapshots.
export default async function QuotationsPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageQuotations(session.user.role)) redirect("/dashboard");

  const [rows, customers, currency] = await Promise.all([getQuotationRows(), db.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }), getDefaultCurrency()]);
  return <QuotationsTable rows={rows} customers={customers} currency={currency ? { code: currency.code, symbol: currency.symbol, right: currency.right } : null} />;
}
