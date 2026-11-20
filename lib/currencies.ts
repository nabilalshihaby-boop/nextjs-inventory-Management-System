import { z } from "zod";

// Shared Currency rules (used by the Server Actions; safe to import on the client too).

export type CurrencyRow = { id: string; name: string; code: string; symbol: string };

export const currencyInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, "Code is required")
    .regex(/^[A-Z]{3}$/, "Code must be exactly 3 letters, e.g. EGP"),
  symbol: z.string().trim().min(1, "Symbol is required").max(10, "Symbol is too long"),
});

export type CurrencyInput = z.infer<typeof currencyInputSchema>;
export type CurrencyField = keyof CurrencyInput;
