import { z } from "zod";
import { toUnits } from "@/lib/transfers";

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

/** Create/update payload. Only ids, quantities, types and date are accepted; anything else is stripped. */
export const adjustmentInputSchema = z
  .object({
    warehouseId: id("Warehouse is required"),
    adjustmentDate: z.string({ error: "Date is required" }).trim().min(1, "Date is required").refine(isValidDate, "Enter a valid date"),
    items: z
      .array(
        z.object({
          productId: id("Choose a valid product"),
          quantity: z
            .string({ error: "Quantity is required" })
            .trim()
            .refine((v) => QTY_RE.test(v), "Quantity must be a number with up to 3 decimal places")
            .refine((v) => !QTY_RE.test(v) || toUnits(v, 3) > BigInt(0), "Quantity must be greater than 0"),
          type: z.enum(ADJUSTMENT_TYPES, { error: "Choose Addition or Subtraction" }),
        }),
        { error: "Add at least one product" },
      )
      .min(1, "Add at least one product")
      .max(MAX_ADJUSTMENT_ITEMS, `Up to ${MAX_ADJUSTMENT_ITEMS} products per adjustment`),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    for (const i of v.items) {
      if (seen.has(i.productId)) {
        ctx.addIssue({ code: "custom", path: ["items"], message: "Each product can appear only once" });
        break;
      }
      seen.add(i.productId);
    }
  });

export type AdjustmentInput = z.infer<typeof adjustmentInputSchema>;
export type AdjustmentField = "warehouseId" | "adjustmentDate" | "items";

/** Signed effect of one line in thousandths (ADDITION +, SUBTRACTION −). */
export const signedUnits = (quantity: string, type: AdjustmentTypeValue) => (type === "ADDITION" ? toUnits(quantity, 3) : -toUnits(quantity, 3));

// ---- View-model types ---------------------------------------------------------------------------

export type ProductPick = { productId: string; code: string; name: string; unit: string };
export type StockLevel = { productId: string; warehouseId: string; quantity: string };

export type AdjustmentFormValues = {
  warehouseId: string;
  adjustmentDate: string;
  items: { productId: string; quantity: string; type: AdjustmentTypeValue }[];
};

export type AdjustmentRow = {
  id: string;
  reference: string;
  warehouse: string;
  date: string;
  lines: { product: string; code: string; type: AdjustmentTypeValue; quantity: string; unit: string }[];
};
