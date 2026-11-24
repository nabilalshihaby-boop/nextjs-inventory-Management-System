import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { getLedgerView } from "@/lib/cash-bank-data";
import { canRecordCashBankTransactions, canViewFinance } from "@/lib/roles";
import { todayLocal } from "@/lib/cash-bank";
import { getDict, getLocaleInfo } from "@/lib/i18n/server";
import TransactionsView from "@/components/finance/TransactionsView";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).finance.transactions.title };
}

export const instant = false;

// Cash & Bank Transactions (design/Cash - Bank Transactions.html). OWNER/ADMIN only — USER is
// redirected before any finance data is read. `?account=<id>` preselects the account filter.
export default async function CashBankTransactionsPage({ searchParams }: PageProps<"/finance/transactions">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canViewFinance(session.user)) redirect("/dashboard");

    const sp = await searchParams;
  const { dict, locale } = await getLocaleInfo();
  const data = await getLedgerView(dict, locale);
  const wanted = typeof sp.account === "string" ? sp.account : "";
  const initialAccount = data.accounts.some((a) => a.id === wanted) ? wanted : "";
  return <TransactionsView {...data} initialAccount={initialAccount} today={todayLocal()} canRecord={canRecordCashBankTransactions(session.user)} />;
}
