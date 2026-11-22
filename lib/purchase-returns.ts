import { z } from "zod";
import { makeTxDate } from "@/lib/cash-bank";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n";
import { toUnits } from "@/lib/transfers";

// Shared Purchase Return rules (client + server). The browser only sends the purchase id, the
// purchase-line ids and quantities, the date and notes — everything else is read on the server.

/** "PR_000001" — generated server-side from the AUTO_INCREMENT number. */
export const formatPurchaseReturnReference = (n: number) => `PR_${String(n).padStart(6, "0")}`;

const QTY_RE = /^\d{1,11}(\.\d{1,3})?$/;
const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);

/** Return payload schema; messages are dictionary text (English by default). */
export function makePurchaseReturnSchema(m: Dictionary["purchaseReturns"]["val"] = en.purchaseReturns.val, d: Dictionary["purchases"]["val"] = en.purchases.val) {
  return z
    .object({
      returnDate: makeTxDate({ required: d.dateRequired, invalid: d.dateInvalid, future: d.dateFuture }),
      purchaseId: id(m.choosePurchase),
      notes: z.string().trim().max(2000, m.notesLong).optional().default(""),
      items: z
        .array(
          z.object({
            purchaseItemId: id(m.chooseLine),
            quantity: z
              .string({ error: m.qtyRequired })
              .trim()
              .refine((v) => QTY_RE.test(v), m.qtyFormat)
              .refine((v) => !QTY_RE.test(v) || toUnits(v, 3) > BigInt(0), m.qtyPositive),
          }),
          { error: m.addLine },
        )
        .min(1, m.minLine)
        .max(200, m.maxLines),
    })
    .superRefine((v, ctx) => {
      const seen = new Set<string>();
      for (const i of v.items) {
        if (seen.has(i.purchaseItemId)) {
          ctx.addIssue({ code: "custom", path: ["items"], message: m.uniqueLine });
          break;
        }
        seen.add(i.purchaseItemId);
      }
    });
}
export const purchaseReturnInputSchema = makePurchaseReturnSchema();

export type PurchaseReturnInput = z.infer<typeof purchaseReturnInputSchema>;
export type PurchaseReturnField = "returnDate" | "purchaseId" | "notes" | "items";

// ---- view models ----
export type ReturnSourceLine = {
  purchaseItemId: string;
  productId: string;
  code: string;
  name: string;
  unit: string; // the ORIGINAL line's unit (a return uses it)
  factor: string; // base units in one of that unit (snapshot)
  baseUnit: string; // stock is counted in this unit
  quantity: string; // originally purchased (3 dp)
  returned: string; // already returned (3 dp)
  stock: string; // current stock in the purchase warehouse (3 dp)
  netUnitCost: string;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
};
export type ReturnSourcePurchase = {
  id: string;
  reference: string;
  /** Grand Total − Paid − earlier returns: a return can't exceed it (refund/credit not built). */
  due: string;
  date: string; // YYYY-MM-DD (return date can't be earlier)
  dateLabel: string;
  supplier: string;
  warehouse: string;
  subtotal: string;
  orderTaxAmount: string;
  orderTaxRate: string;
  discount: string;
  returnedSubtotal: string;
  currency: { code: string; symbol: string; right: boolean };
  lines: ReturnSourceLine[];
};
export type PurchaseReturnRow = {
  id: string;
  reference: string;
  purchaseRef: string;
  supplier: string;
  warehouse: string;
  date: string; // YYYY-MM-DD
  grandTotal: string;
  currency: { code: string; symbol: string; right: boolean };
  inDefaultCurrency: boolean;
  createdOn: string;
};
