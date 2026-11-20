import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageSupplierPayments } from "@/lib/roles";
import { getDefaultCurrency } from "@/lib/settings";
import { getSupplierPaymentRows } from "@/lib/supplier-payment-data";
import SupplierPaymentsTable from "@/components/supplier-payments/SupplierPaymentsTable";

export const metadata: Metadata = { title: "Supplier Payments" };

export const instant = false;

// Supplier Payments list (design/Supplier Payments.html). OWNER/ADMIN only — USER is redirected
// before anything is read. Payments are immutable records; amounts are server-stored values.
export default async function SupplierPaymentsPage({ searchParams }: PageProps<"/supplier-payments">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageSupplierPayments(session.user.role)) redirect("/dashboard");

  const [rows, suppliers, currency] = await Promise.all([
    getSupplierPaymentRows(),
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getDefaultCurrency(),
  ]);
  const q = (await searchParams).q; // e.g. a payment reference linked from the supplier statement
  return <SupplierPaymentsTable rows={rows} suppliers={suppliers} currency={currency ? { code: currency.code, symbol: currency.symbol, right: currency.right } : null} initialQuery={typeof q === "string" ? q.slice(0, 64) : ""} />;
}
