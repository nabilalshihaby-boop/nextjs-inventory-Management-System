import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { todayLocal } from "@/lib/cash-bank";
import { db } from "@/lib/db";
import { getAgingCurrencies } from "@/lib/aging";
import { canViewAging } from "@/lib/roles";
import { getDict } from "@/lib/i18n/server";
import AgingForm from "@/components/reports/AgingForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).aging.title };
}

export const instant = false;

// Receivables & Payables Aging parameter page (OWNER/ADMIN only). The role is re-read BEFORE anything is loaded; "View Report" opens
// the separate print-friendly report route. Read-only: nothing is written here.
export default async function Page({ searchParams }: PageProps<"/receivables-payables-aging">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canViewAging(session.user)) redirect("/dashboard");

  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 64) : "");
  const [{ currencies }, customers, suppliers] = await Promise.all([
    getAgingCurrencies("both"),
    db.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const today = todayLocal();
  return (
    <AgingForm
      currencies={currencies.map((c) => ({ id: c.id, label: `${c.code} (${c.symbol}) — ${c.name}` }))}
      customers={customers.map((c) => ({ id: c.id, label: c.name }))}
      suppliers={suppliers.map((c) => ({ id: c.id, label: c.name }))}
      initial={{ type: s("type"), asOf: s("asOf") || today, currency: s("currency"), customer: s("customer"), supplier: s("supplier") }}
      today={today}
    />
  );
}
