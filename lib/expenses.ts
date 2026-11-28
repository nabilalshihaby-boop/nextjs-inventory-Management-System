import { z } from "zod";
import { makeTxDate, positiveMoneyWith } from "@/lib/cash-bank";
import { fmt } from "@/lib/i18n/config";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n";

// Shared Expense rules (client + server). Money is a 2-dp decimal string; never floats.

/** "EX_000001" — generated server-side from the AUTO_INCREMENT number. */
export const formatExpenseReference = (n: number) => `EX_${String(n).padStart(6, "0")}`;

/** Ledger purposes written by the Expenses module (never selectable as manual cash/bank purposes). */
export const EXPENSE_PURPOSE = "Operating Expense";
export const EXPENSE_REVERSAL_PURPOSE = "Expense Reversal";

const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);

/** Create/update payload schema. Only ids, amount, date, title and details — anything else is stripped. Messages are dictionary text. */
export function makeExpenseSchema(m: Dictionary["expenses"]["val"] = en.expenses.val, f: Dictionary["finance"]["val"] = en.finance.val) {
  const label = f.labels.amount;
  return z.object({
    expenseDate: makeTxDate({ required: f.dateRequired, invalid: f.dateInvalid, future: f.dateFuture }),
    title: z.string({ error: m.titleRequired }).trim().min(1, m.titleRequired).max(191, m.titleLong),
    warehouseId: id(m.chooseWarehouse),
    categoryId: id(m.chooseCategory),
    cashBankAccountId: id(m.chooseAccount),
    amount: positiveMoneyWith({ required: fmt(f.required, { label }), format: fmt(f.money, { label }), positive: fmt(f.positive, { label }) }),
    details: z.string().trim().max(2000, m.detailsLong).optional().default(""),
  });
}
export const expenseInputSchema = makeExpenseSchema();

export type ExpenseInput = z.infer<typeof expenseInputSchema>;
export type ExpenseField = keyof ExpenseInput;
export type ExpenseFormValues = Record<ExpenseField, string>;

export type ExpenseOption = { value: string; label: string };
export type PaidFromOption = { value: string; name: string; label: string; /** null when the viewer lacks finance.view */ balance: string | null; active: boolean; inDefaultCurrency: boolean };

export type ExpenseRow = {
  id: string;
  reference: string;
  title: string;
  warehouse: string;
  category: string;
  account: string;
  amount: string; // formatted
  createdOn: string;
};
