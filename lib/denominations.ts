import { z } from "zod";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n";

// Cash denominations (client + server). Owner-managed, per currency, never seeded.

const VALUE_RE = /^\d{1,12}(\.\d{1,2})?$/; // DECIMAL(14,2)
const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);
export const MAX_COUNT_PER_DENOMINATION = 1_000_000;

/** Denomination schemas with dictionary messages (English by default). */
export function makeDenominationSchemas(m: Dictionary["denom"]["val"] = en.denom.val) {
  const value = z
    .string({ error: m.valueRequired })
    .trim()
    .min(1, m.valueRequired)
    .refine((v) => VALUE_RE.test(v), m.valueFormat)
    .refine((v) => !VALUE_RE.test(v) || /[1-9]/.test(v), m.valuePositive);
  const label = z.string().trim().max(60, m.labelLong).optional().default("");
  return {
    denominationCreateSchema: z.object({ currencyId: id(m.chooseCurrency), value, label }).strict(),
    denominationUpdateSchema: z.object({ value, label, active: z.boolean({ error: m.invalidStatus }) }).strict(),
    denominationIdSchema: id(m.notFound),
    /** Counts sent when closing a register: ids and integers only - values, labels and totals are re-read on the server. */
    denominationCountsSchema: z
      .array(
        z
          .object({
            denominationId: id(m.unknown),
            count: z.number({ error: m.countWhole }).int(m.countWhole).min(0, m.countNegative).max(MAX_COUNT_PER_DENOMINATION, m.countLarge),
          })
          .strict(),
      )
      .max(60, m.tooMany),
  };
}
const english = makeDenominationSchemas();
export const denominationCreateSchema = english.denominationCreateSchema;
export const denominationUpdateSchema = english.denominationUpdateSchema;
export const denominationIdSchema = english.denominationIdSchema;
export const denominationCountsSchema = english.denominationCountsSchema;

export type DenominationRow = { id: string; currencyId: string; currencyCode: string; value: string; label: string; active: boolean; used: boolean };
/** Active denominations offered when counting the drawer (display values; the server re-reads them). */
export type CountDenomination = { id: string; value: string; label: string };
