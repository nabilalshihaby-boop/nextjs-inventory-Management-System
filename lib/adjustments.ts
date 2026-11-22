import { z } from "zod";
import { fmt } from "@/lib/i18n/config";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n";
import { toUnits } from "@/lib/transfers";
import type { ProductUnits } from "@/lib/unit-math";

// Shared Stock Adjustment rules (client + server). Quantities are 3-dp decimal strings; arithmetic
// uses scaled BigInt (see lib/transfers.ts) — never floating point.

export const ADJUSTMENT_TYPES = ["ADDITION", "SUBTRACTION"] as const;
export type AdjustmentTypeValue = (typeof ADJUSTMENT_TYPES)[number];
export const TYPE_LABEL: Record<AdjustmentTypeValue, string> = { ADDITION: "Addition", SUBTRACTION: "Subtraction" };
/** Design badge tones: Addition success, Subtraction danger. */
export const TYPE_TONE: Record<AdjustmentTypeValue, string> = { ADDITION: "success", SUBTRACTION: "danger" };

export const MAX_ADJUSTMENT_ITEMS = 200;

/** "AD_000001" — generated server-side from the AUTO_INCREMENT number. */
export const formatAdjustmentReference = (n: number) => `AD_${String(n).padStart(6, "0")}`;

const QTY_RE = /^\d{1,11}(\.\d{1,3})?$/; // DECIMAL(14,3)
const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);

function isValidDate(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2199;
}

/** Create/update payload. Only ids, quantities, types and date are accepted; anything else is stripped. Messages are dictionary text. */
export function makeAdjustmentSchema(m: Dictionary["adjustments"]["val"] = en.adjustments.val) {
  return z
    .object({
      warehouseId: id(m.warehouseRequired),
      adjustmentDate: z.string({ error: m.dateRequired }).trim().min(1, m.dateRequired).refine(isValidDate, m.dateInvalid),
      items: z
        .array(
          z.object({
            productId: id(m.chooseProduct),
            /** The selected product unit (selector only; blank = the base unit). The server resolves factor and base quantity. */
            unitId: z.string().trim().max(64).optional().default(""),
            quantity: z
              .string({ error: m.qtyRequired })
              .trim()
              .refine((v) => QTY_RE.test(v), m.qtyDecimals)
              .refine((v) => !QTY_RE.test(v) || toUnits(v, 3) > BigInt(0), m.qtyPositive),
            type: z.enum(ADJUSTMENT_TYPES, { error: m.chooseType }),
          }),
          { error: m.addProduct },
        )
        .min(1, m.addProduct)
        .max(MAX_ADJUSTMENT_ITEMS, fmt(m.maxItems, { max: MAX_ADJUSTMENT_ITEMS })),
    })
    .superRefine((v, ctx) => {
      const seen = new Set<string>();
      for (const i of v.items) {
        if (seen.has(i.productId)) {
          ctx.addIssue({ code: "custom", path: ["items"], message: m.dupProduct });
          break;
        }
        seen.add(i.productId);
      }
    });
}
export const adjustmentInputSchema = makeAdjustmentSchema();

export type AdjustmentInput = z.infer<typeof adjustmentInputSchema>;
export type AdjustmentField = "warehouseId" | "adjustmentDate" | "items";

/** Signed effect of one line in thousandths (ADDITION +, SUBTRACTION −). */
export const signedUnits = (quantity: string, type: AdjustmentTypeValue) => (type === "ADDITION" ? toUnits(quantity, 3) : -toUnits(quantity, 3));

// ---- View-model types ---------------------------------------------------------------------------

export type ProductPick = { productId: string; code: string; name: string; unit: string; unitInfo: ProductUnits };
export type StockLevel = { productId: string; warehouseId: string; quantity: string };

export type AdjustmentFormValues = {
  warehouseId: string;
  adjustmentDate: string;
  /** unitId = the line's unit; baseQuantity = what the saved line moved stock by (edit form only). */
  items: { productId: string; quantity: string; type: AdjustmentTypeValue; unitId?: string; baseQuantity?: string }[];
};

export type AdjustmentRow = {
  id: string;
  reference: string;
  warehouse: string;
  date: string;
  lines: { product: string; code: string; type: AdjustmentTypeValue; quantity: string; unit: string }[];
};
