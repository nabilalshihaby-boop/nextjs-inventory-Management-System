import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { todayLocal } from "@/lib/cash-bank";
import { canViewCustomerStatement } from "@/lib/roles";
import { getCustomerStatement } from "@/lib/customer-statement-data";
import CustomerStatementView from "@/components/customers/CustomerStatementView";

export const metadata: Metadata = { title: "Customer Statement" };

export const instant = false;

// Customer Account Statement (design/Customer Statement.html). OWNER/ADMIN only — USER is
// redirected before anything is read. ?customer=&from=&to=&currency= select the statement; the
// ledger and running balance are computed on the server from real records only. Read-only.
export default async function CustomerStatementPage({ searchParams }: PageProps<"/customers/statement">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canViewCustomerStatement(session.user.role)) redirect("/dashboard");

  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 64) : undefined);
  const today = todayLocal();
  const data = await getCustomerStatement({ customer: str(sp.customer), from: str(sp.from), to: str(sp.to), currency: str(sp.currency) }, today);
  const st = data?.statement;
  return <CustomerStatementView key={st ? `${st.customer?.id ?? ""}|${st.from}|${st.to}|${st.currency?.id ?? ""}|${data?.notice ?? ""}` : "none"} data={data} today={today} />;
}
