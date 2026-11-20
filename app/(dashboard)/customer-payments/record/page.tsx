import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { todayLocal } from "@/lib/cash-bank";
import { canManageCustomerPayments } from "@/lib/roles";
import { getCustomerPaymentFormData } from "@/lib/customer-payment-data";
import CustomerPaymentForm from "@/components/customer-payments/CustomerPaymentForm";

export const metadata: Metadata = { title: "Record Customer Payment" };

export const instant = false;

// Record Customer Payment (design/Customer Payments.html → its payment modal, as a page like Record
// Supplier Payment). OWNER/ADMIN only. `?sale=<id>`
// (from Sale Details) preselects that sale and its customer.
export default async function RecordCustomerPaymentPage({ searchParams }: PageProps<"/customer-payments/record">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageCustomerPayments(session.user.role)) redirect("/dashboard");

  const sp = await searchParams;
  const data = await getCustomerPaymentFormData();
  const wanted = typeof sp.sale === "string" ? data.payables.find((p) => p.id === sp.sale) : undefined;
  const customer = wanted?.customerId ?? (typeof sp.customer === "string" && data.customers.some((s) => s.id === sp.customer) ? sp.customer : "");
  return <CustomerPaymentForm {...data} today={todayLocal()} initialCustomer={customer} initialSale={wanted?.id ?? ""} />;
}
