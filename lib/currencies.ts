import { z } from "zod";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n";

// Shared Currency rules (used by the Server Actions; safe to import on the client too).

export type CurrencyRow = { id: string; name: string; code: string; symbol: string };

/** Validation schema; messages are dictionary text (English by default). */
export function makeCurrencySchema(m: Dictionary["currencies"]["val"] = en.currencies.val) {
  return z.object({
    name: z.string().trim().min(1, m.nameRequired).max(100, m.nameLong),
    code: z.string().trim().toUpperCase().min(1, m.codeRequired).regex(/^[A-Z]{3}$/, m.codeFormat),
    symbol: z.string().trim().min(1, m.symbolRequired).max(10, m.symbolLong),
  });
}
export const currencyInputSchema = makeCurrencySchema();

export type CurrencyInput = z.infer<typeof currencyInputSchema>;
export type CurrencyField = keyof CurrencyInput;
