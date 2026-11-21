// Server-only loaders for the Expenses pages (OWNER/ADMIN — callers check the role first).
import { fmt } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";
import { db } from "@/lib/db";
import { computeBalances } from "@/lib/cash-bank-server";
import { formatMoney } from "@/lib/money";
import { getDefaultCurrency } from "@/lib/settings";
import type { ExpenseOption, PaidFromOption } from "@/lib/expenses";

export type ExpenseFormData = {
  warehouses: ExpenseOption[];
  categories: ExpenseOption[];
  accounts: PaidFromOption[];
  currency: { code: string; symbol: string; right: boolean } | null;
};

/**
 * Real options for the Create/Update Expense form. `accounts` lists every cash/bank account with its
 * computed balance; only active accounts in the default currency are selectable. Display only —
 * the server re-checks everything (under the account lock) when saving.
 */
export async function getExpenseFormData(T: Dictionary): Promise<ExpenseFormData> {
  const [warehouses, categories, accounts, currency] = await Promise.all([
    db.warehouse.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.expenseCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.cashBankAccount.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, status: true, currencyId: true, currency: { select: { symbol: true, code: true } } } }),
    getDefaultCurrency(),
  ]);
  const balances = await computeBalances(db, accounts.map((a) => a.id));
  return {
    warehouses: warehouses.map((w) => ({ value: w.id, label: w.name })),
    categories: categories.map((c) => ({ value: c.id, label: c.name })),
    accounts: accounts.map((a) => {
      const balance = balances.get(a.id)?.toFixed(2) ?? "0.00";
      return {
        value: a.id,
                name: a.name,
        label: fmt(T.expenses.form.accountOption, { name: a.name, balance: formatMoney(balance, { code: a.currency.code, symbol: a.currency.symbol, right: !!currency?.right }) }),
        balance,
        active: a.status === "ACTIVE",
        inDefaultCurrency: !!currency && a.currencyId === currency.id,
      };
    }),
    currency: currency ? { code: currency.code, symbol: currency.symbol, right: currency.right } : null,
  };
}
