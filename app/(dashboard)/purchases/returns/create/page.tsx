import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { canManagePurchaseReturns } from "@/lib/roles";
import { getReturnSources } from "@/lib/purchase-return-data";
import { todayLocal } from "@/lib/cash-bank";
import { getDict } from "@/lib/i18n/server";
import PurchaseReturnForm from "@/components/purchases/PurchaseReturnForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).purchaseReturns.form.title };
}

export const instant = false;

// Create Purchase Return (design/Create Purchase Return.html). OWNER/ADMIN only. `?purchase=<id>`
// preselects a purchase (from its details page).
export default async function CreatePurchaseReturnPage({ searchParams }: PageProps<"/purchases/returns/create">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManagePurchaseReturns(session.user)) redirect("/dashboard");

  const sp = await searchParams;
  const sources = await getReturnSources();
  const wanted = typeof sp.purchase === "string" ? sp.purchase : "";
  return <PurchaseReturnForm sources={sources} today={todayLocal()} initialPurchase={sources.some((s) => s.id === wanted) ? wanted : ""} />;
}
