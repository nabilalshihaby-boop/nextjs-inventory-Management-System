import { z } from "zod";
import { positiveMoneySchema, transactionDateSchema } from "@/lib/cash-bank";

// Shared Expense rules (client + server). Money is a 2-dp decimal string; never floats.

/** "EX_000001" — generated server-side from the AUTO_INCREMENT number. */
export const formatExpenseReference = (n: number) => `EX_${String(n).padStart(6, "0")}`;

/** Ledger purposes written by the Expenses module (never selectable as manual cash/bank purposes). */
export const EXPENSE_PURPOSE = "Operating Expense";
export const EXPENSE_REVERSAL_PURPOSE = "Expense Reversal";

const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);

/** Create/update payload. Only ids, amount, date, title and details — anything else is stripped. */
export const expenseInputSchema = z.object({
  expenseDate: transactionDateSchema,
  title: z.string({ error: "Expense title is required" }).trim().min(1, "Expense title is required").max(191, "Expense title is too long"),
  warehouseId: id("Choose a warehouse"),
  categoryId: id("Choose an expense category"),
  cashBankAccountId: id("Choose the account the expense is paid from"),
  amount: positiveMoneySchema("Amount"),
  details: z.string().trim().max(2000, "Details are too long").optional().default(""),
});

export type ExpenseInput = z.infer<typeof expenseInputSchema>;
export type ExpenseField = keyof ExpenseInput;
export type ExpenseFormValues = Record<ExpenseField, string>;

export type ExpenseOption = { value: string; label: string };
export type PaidFromOption = { value: string; label: string; balance: string; active: boolean; inDefaultCurrency: boolean };

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
