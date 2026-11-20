import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { canManageSaleReturns } from "@/lib/roles";
import { getSaleReturnSources } from "@/lib/sale-return-data";
import { todayLocal } from "@/lib/cash-bank";
import SaleReturnForm from "@/components/sales/SaleReturnForm";

export const metadata: Metadata = { title: "Create Sale Return" };

export const instant = false;

// Create Sale Return (design/Create Sale Return.html). OWNER/ADMIN only. `?sale=<id>` preselects a
// completed sale (from its details page or the sales list).
export default async function CreateSaleReturnPage({ searchParams }: PageProps<"/sales/returns/create">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageSaleReturns(session.user.role)) redirect("/dashboard");

  const sp = await searchParams;
  const sources = await getSaleReturnSources();
  const wanted = typeof sp.sale === "string" ? sp.sale : "";
  return <SaleReturnForm sources={sources} today={todayLocal()} initialSale={sources.some((s) => s.id === wanted) ? wanted : ""} />;
}
