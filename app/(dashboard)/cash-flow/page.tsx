import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { todayLocal } from "@/lib/cash-bank";
import { getCashFlowCurrencies } from "@/lib/cash-flow";
import { canViewCashFlow } from "@/lib/roles";
import { getDict } from "@/lib/i18n/server";
import CashFlowForm from "@/components/reports/CashFlowForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).cashFlow.title };
}

export const instant = false;

// Cash Flow parameter page (OWNER/ADMIN only). The role is re-read BEFORE anything is loaded; "View Report" opens the separate
// print-friendly report route (/reports/cash-flow). Read-only: nothing is written here.
export default async function Page({ searchParams }: PageProps<"/cash-flow">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canViewCashFlow(session.user.role)) redirect("/dashboard");

  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 64) : "");
  const { currencies } = await getCashFlowCurrencies();
  const today = todayLocal();
  return (
    <CashFlowForm
      currencies={currencies.map((c) => ({ id: c.id, label: `${c.code} (${c.symbol}) — ${c.name}` }))}
      initial={{ from: s("from") || `${today.slice(0, 8)}01`, to: s("to") || today, currency: s("currency") }}
    />
  );
}
