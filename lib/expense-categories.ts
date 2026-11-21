import { z } from "zod";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n";

// Shared Expense Category rules (Server Actions validate with this; safe to import on the client).
export function makeExpenseCategorySchema(m: Dictionary["expenses"]["val"] = en.expenses.val) {
  return z.object({ name: z.string({ error: m.catNameRequired }).trim().min(1, m.catNameRequired).max(120, m.catNameLong) });
}
export const expenseCategorySchema = makeExpenseCategorySchema();

export type ExpenseCategoryRow = { id: string; name: string };
