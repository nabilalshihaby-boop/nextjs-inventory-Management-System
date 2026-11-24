import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { canManageExpenses } from "@/lib/roles";
import { getSystemSettings } from "@/lib/settings";
import type { ExpenseRow } from "@/lib/expenses";
import { getDict, getLocale } from "@/lib/i18n/server";
import ExpensesTable from "@/components/expenses/ExpensesTable";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).expenses.list.title };
}

export const instant = false;

// Expenses list (design/Expenses.html). Finance data: OWNER/ADMIN only — USER is redirected before
// anything is read. Soft-deleted (reversed) expenses are hidden.
export default async function ExpensesPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageExpenses(session.user)) redirect("/dashboard");

    const locale = await getLocale();
  const [expenses, settings] = await Promise.all([
    db.expense.findMany({
      where: { deletedAt: null },
      orderBy: { number: "desc" },
      select: {
        id: true,
        reference: true,
        title: true,
        amount: true,
        createdAt: true,
        warehouse: { select: { name: true } },
        category: { select: { name: true } },
        cashBankAccount: { select: { name: true, currency: { select: { code: true, symbol: true } } } },
      },
    }),
    getSystemSettings(),
  ]);
  const right = !!settings?.currencyIconRight;
  const rows: ExpenseRow[] = expenses.map((e) => ({
    id: e.id,
    reference: e.reference,
    title: e.title,
    warehouse: e.warehouse.name,
    category: e.category.name,
    account: e.cashBankAccount.name,
    amount: formatMoney(e.amount.toFixed(2), { ...e.cashBankAccount.currency, right }), // the paying account's currency
    createdOn: formatDateTime(e.createdAt, settings?.dateFormat, locale),
  }));
  return <ExpensesTable rows={rows} />;
}
