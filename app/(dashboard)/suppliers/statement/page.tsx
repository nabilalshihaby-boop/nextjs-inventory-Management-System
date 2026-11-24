import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { todayLocal } from "@/lib/cash-bank";
import { canViewSupplierStatement } from "@/lib/roles";
import { getSupplierStatement } from "@/lib/supplier-statement-data";
import { getDict } from "@/lib/i18n/server";
import SupplierStatementView from "@/components/suppliers/SupplierStatementView";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).nav.supplierStatement };
}

export const instant = false;

// Supplier Account Statement (design/Supplier Statement.html). OWNER/ADMIN only — USER is
// redirected before anything is read. ?supplier=&from=&to=&currency= select the statement; the
// ledger and running balance are computed on the server from real records only.
export default async function SupplierStatementPage({ searchParams }: PageProps<"/suppliers/statement">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canViewSupplierStatement(session.user)) redirect("/dashboard");

  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const today = todayLocal();
  const data = await getSupplierStatement({ supplier: str(sp.supplier), from: str(sp.from), to: str(sp.to), currency: str(sp.currency) }, today, await getDict());
  // Keyed by what was actually loaded, so the filter form / search reset to the server's values.
  const st = data?.statement;
  return <SupplierStatementView key={st ? `${st.supplier.id}|${st.from}|${st.to}|${st.currency?.id ?? ""}` : "none"} data={data} today={today} />;
}
