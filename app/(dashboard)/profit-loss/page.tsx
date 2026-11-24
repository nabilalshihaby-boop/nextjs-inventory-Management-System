import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { todayLocal } from "@/lib/cash-bank";
import { getActiveCurrencies } from "@/lib/profit-loss";
import { canSetCostBaseline, canViewProfitLoss } from "@/lib/roles";
import { getDict } from "@/lib/i18n/server";
import ProfitLossForm from "@/components/reports/ProfitLossForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).profitLoss.title };
}

export const instant = false;

// Profit & Loss parameter page (OWNER/ADMIN only). The role is re-read BEFORE anything is loaded; "View Report"
// opens the separate print-friendly report route (/reports/profit-loss). Read-only: nothing is written here.
export default async function Page({ searchParams }: PageProps<"/profit-loss">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canViewProfitLoss(session.user)) redirect("/dashboard");

  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 64) : "");
  const { currencies } = await getActiveCurrencies();
  const today = todayLocal();
  return (
    <ProfitLossForm
      currencies={currencies.map((c) => ({ id: c.id, label: `${c.code} (${c.symbol}) — ${c.name}` }))}
      canSetup={canSetCostBaseline(session.user)}
      initial={{ from: s("from") || `${today.slice(0, 8)}01`, to: s("to") || today, currency: s("currency") }}
    />
  );
}
