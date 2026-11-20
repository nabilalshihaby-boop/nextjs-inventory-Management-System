import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { getLedgerView } from "@/lib/cash-bank-data";
import { canRecordCashBankTransactions, canViewFinance } from "@/lib/roles";
import { todayLocal } from "@/lib/cash-bank";
import TransactionsView from "@/components/finance/TransactionsView";

export const metadata: Metadata = { title: "Cash & Bank Transactions" };

export const instant = false;

// Cash & Bank Transactions (design/Cash - Bank Transactions.html). OWNER/ADMIN only — USER is
// redirected before any finance data is read. `?account=<id>` preselects the account filter.
export default async function CashBankTransactionsPage({ searchParams }: PageProps<"/finance/transactions">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canViewFinance(session.user.role)) redirect("/dashboard");

  const sp = await searchParams;
  const data = await getLedgerView();
  const wanted = typeof sp.account === "string" ? sp.account : "";
  const initialAccount = data.accounts.some((a) => a.id === wanted) ? wanted : "";
  return <TransactionsView {...data} initialAccount={initialAccount} today={todayLocal()} canRecord={canRecordCashBankTransactions(session.user.role)} />;
}
