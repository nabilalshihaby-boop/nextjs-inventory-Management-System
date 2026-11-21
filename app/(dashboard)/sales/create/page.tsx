import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { todayLocal } from "@/lib/cash-bank";
import { canManageSales, canManageSystemSettings } from "@/lib/roles";
import { getSaleFormData } from "@/lib/sale-data";
import { getDict } from "@/lib/i18n/server";
import SaleForm from "@/components/sales/SaleForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).sales.form.createTitle };
}

export const instant = false;

// Create Sale (design/Create Sale.html). OWNER/ADMIN only.
export default async function CreateSalePage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageSales(session.user.role)) redirect("/dashboard");

  const data = await getSaleFormData();
  return <SaleForm {...data} today={todayLocal()} canOpenSettings={canManageSystemSettings(session.user.role)} />;
}
