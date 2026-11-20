import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageCustomerPayments } from "@/lib/roles";
import { getDefaultCurrency } from "@/lib/settings";
import { getCustomerPaymentRows } from "@/lib/customer-payment-data";
import CustomerPaymentsTable from "@/components/customer-payments/CustomerPaymentsTable";

export const metadata: Metadata = { title: "Customer Payments" };

export const instant = false;

// Customer Payments list (design/Customer Payments.html). OWNER/ADMIN only — USER is redirected
// before anything is read. Payments are immutable records; amounts are server-stored values.
export default async function CustomerPaymentsPage({ searchParams }: PageProps<"/customer-payments">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageCustomerPayments(session.user.role)) redirect("/dashboard");

  const [rows, customers, currency] = await Promise.all([
    getCustomerPaymentRows(),
    db.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getDefaultCurrency(),
  ]);
  const q = (await searchParams).q; // e.g. a payment reference linked from the customer statement
  return <CustomerPaymentsTable rows={rows} customers={customers} currency={currency ? { code: currency.code, symbol: currency.symbol, right: currency.right } : null} initialQuery={typeof q === "string" ? q.slice(0, 64) : ""} />;
}
