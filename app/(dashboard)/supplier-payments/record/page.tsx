import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { todayLocal } from "@/lib/cash-bank";
import { canManageSupplierPayments } from "@/lib/roles";
import { getSupplierPaymentFormData } from "@/lib/supplier-payment-data";
import { getDict } from "@/lib/i18n/server";
import SupplierPaymentForm from "@/components/supplier-payments/SupplierPaymentForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).supplierPay.form.title };
}

export const instant = false;

// Record Supplier Payment (design/Record Supplier Payment.html). OWNER/ADMIN only. `?purchase=<id>`
// (from Purchase Details) preselects that purchase and its supplier.
export default async function RecordSupplierPaymentPage({ searchParams }: PageProps<"/supplier-payments/record">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageSupplierPayments(session.user)) redirect("/dashboard");

  const sp = await searchParams;
  const data = await getSupplierPaymentFormData();
  const wanted = typeof sp.purchase === "string" ? data.payables.find((p) => p.id === sp.purchase) : undefined;
  const supplier = wanted?.supplierId ?? (typeof sp.supplier === "string" && data.suppliers.some((s) => s.id === sp.supplier) ? sp.supplier : "");
  return <SupplierPaymentForm {...data} today={todayLocal()} initialSupplier={supplier} initialPurchase={wanted?.id ?? ""} />;
}
