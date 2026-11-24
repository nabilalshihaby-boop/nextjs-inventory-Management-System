import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { canViewInventoryReports } from "@/lib/roles";
import { getFilterOptions } from "@/lib/inventory-reports";
import { getDict } from "@/lib/i18n/server";
import InventoryReportForm from "@/components/reports/InventoryReportForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).invReports.low.title };
}

export const instant = false;

// Inventory Reports parameter page (OWNER/ADMIN only). The role is re-read BEFORE any option (warehouse,
// product, category, brand) is loaded; "View Report" opens the separate print-friendly report route.
export default async function Page({ searchParams }: PageProps<"/inventory-reports/low-stock">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canViewInventoryReports(session.user)) redirect("/dashboard");

  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 64) : "");
  const options = await getFilterOptions();
  return <InventoryReportForm kind="low" options={options} initial={{ warehouse: s("warehouse"), category: s("category"), brand: s("brand") }} />;
}
