import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { canManagePurchases, canManageSystemSettings } from "@/lib/roles";
import { getPurchaseFormData } from "@/lib/purchase-data";
import { todayLocal } from "@/lib/cash-bank";
import PurchaseForm from "@/components/purchases/PurchaseForm";

export const metadata: Metadata = { title: "Create Purchase" };

export const instant = false;

// Create Purchase (design/Create Purchase.html). OWNER/ADMIN only.
export default async function CreatePurchasePage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManagePurchases(session.user.role)) redirect("/dashboard");

  return <PurchaseForm {...await getPurchaseFormData()} today={todayLocal()} canOpenSettings={canManageSystemSettings(session.user.role)} />;
}
