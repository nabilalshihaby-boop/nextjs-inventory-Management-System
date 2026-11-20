import { z } from "zod";

// Shared Expense Category rules (Server Actions validate with this; safe to import on the client).
export const expenseCategorySchema = z.object({
  name: z.string({ error: "Name is required" }).trim().min(1, "Name is required").max(120, "Name must be 120 characters or fewer"),
});

export type ExpenseCategoryRow = { id: string; name: string };
