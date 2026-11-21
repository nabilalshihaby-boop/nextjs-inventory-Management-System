import { z } from "zod";

// Cash denominations (client + server). Owner-managed, per currency, never seeded.

const VALUE_RE = /^\d{1,12}(\.\d{1,2})?$/; // DECIMAL(14,2)
const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);
const value = z
  .string({ error: "Value is required" })
  .trim()
  .min(1, "Value is required")
  .refine((v) => VALUE_RE.test(v), "Value must be a number with up to 2 decimal places")
  .refine((v) => !VALUE_RE.test(v) || /[1-9]/.test(v), "Value must be greater than 0");
const label = z.string().trim().max(60, "The label is too long").optional().default("");

export const denominationCreateSchema = z.object({ currencyId: id("Choose a currency"), value, label }).strict();
export const denominationUpdateSchema = z.object({ value, label, active: z.boolean({ error: "Invalid status" }) }).strict();
export const denominationIdSchema = id("Denomination not found");

/** Counts sent when closing a register: ids and integers only - values, labels and totals are re-read on the server. */
export const MAX_COUNT_PER_DENOMINATION = 1_000_000;
export const denominationCountsSchema = z
  .array(
    z
      .object({
        denominationId: id("Unknown denomination"),
        count: z.number({ error: "Count must be a whole number" }).int("Count must be a whole number").min(0, "Count cannot be negative").max(MAX_COUNT_PER_DENOMINATION, "Count is too large"),
      })
      .strict(),
  )
  .max(60, "Too many denominations");

export type DenominationRow = { id: string; currencyId: string; currencyCode: string; value: string; label: string; active: boolean; used: boolean };
/** Active denominations offered when counting the drawer (display values; the server re-reads them). */
export type CountDenomination = { id: string; value: string; label: string };
