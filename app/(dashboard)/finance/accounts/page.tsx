import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { getAccountsView } from "@/lib/cash-bank-data";
import { canManageCashBankAccounts, canManageSystemSettings, canViewFinance } from "@/lib/roles";
import AccountsView from "@/components/finance/AccountsView";

export const metadata: Metadata = { title: "Cash & Bank Accounts" };

export const instant = false;

// Cash & Bank Accounts (design/Cash - Bank Accounts.html). OWNER/ADMIN only — USER is redirected
// before any finance data is read. OWNER and ADMIN get account create/edit/activate controls.
export default async function CashBankAccountsPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canViewFinance(session.user.role)) redirect("/dashboard");

  const data = await getAccountsView();
  return <AccountsView {...data} canManage={canManageCashBankAccounts(session.user.role)} canOpenSettings={canManageSystemSettings(session.user.role)} />;
}
