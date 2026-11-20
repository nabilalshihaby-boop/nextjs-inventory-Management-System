import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { todayLocal } from "@/lib/cash-bank";
import { canManageQuotations, canManageSystemSettings } from "@/lib/roles";
import { getQuotationFormData } from "@/lib/quotation-data";
import QuotationForm from "@/components/quotations/QuotationForm";

export const metadata: Metadata = { title: "Create Quotation" };

export const instant = false;

// Create Quotation (design/Create Quotation.html). OWNER/ADMIN only.
export default async function CreateQuotationPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageQuotations(session.user.role)) redirect("/dashboard");

  const data = await getQuotationFormData();
  return <QuotationForm {...data} today={todayLocal()} canOpenSettings={canManageSystemSettings(session.user.role)} />;
}
