import { z } from "zod";
import { makeTxDate } from "@/lib/cash-bank";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n";
import { toUnits, fromUnits } from "@/lib/transfers";

// Shared Sales Return rules (client + server). The browser only sends the sale id, the sale-line
// ids and quantities, the date and notes — everything else (customer, warehouse, currency, product,
// price, tax, discount, returnable quantity, totals, reference, status) is read on the server.
// Amounts use the exact cumulative proration of lib/purchase-return-calc.ts on the sale's stored
// snapshot; shipping is never returned.

/** "SR_000001" — generated server-side from the AUTO_INCREMENT number (never reused). */
export const formatSaleReturnReference = (n: number) => `SR_${String(n).padStart(6, "0")}`;

/**
 * A sale's effective Due:  max(0, Grand Total − Paid − Σ completed sales-return grand totals).
 * (Paid is always 0 until customer payments exist.)
 */
export function saleDue(grand: string, paid: string, returned: string): string {
  const d = toUnits(grand, 2) - toUnits(paid, 2) - toUnits(returned, 2);
  return fromUnits(d < BigInt(0) ? BigInt(0) : d, 2);
}

const QTY_RE = /^\d{1,11}(\.\d{1,3})?$/;
const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);

/** Return payload schema; messages are dictionary text (English by default). */
export function makeSaleReturnSchema(m: Dictionary["salesReturns"]["val"] = en.salesReturns.val, d: Dictionary["sales"]["val"] = en.sales.val) {
  return z
    .object({
      returnDate: makeTxDate({ required: d.dateRequired, invalid: d.dateInvalid, future: d.dateFuture }),
      saleId: id(m.chooseSale),
      notes: z.string().trim().max(2000, m.notesLong).optional().default(""),
      items: z
        .array(
          z.object({
            saleItemId: id(m.chooseLine),
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
    .strict()
    .superRefine((v, ctx) => {
      const seen = new Set<string>();
      for (const i of v.items) {
        if (seen.has(i.saleItemId)) {
          ctx.addIssue({ code: "custom", path: ["items"], message: m.uniqueLine });
          break;
        }
        seen.add(i.saleItemId);
      }
    });
}
export const saleReturnInputSchema = makeSaleReturnSchema();

export type SaleReturnInput = z.infer<typeof saleReturnInputSchema>;
export type SaleReturnField = "returnDate" | "saleId" | "notes" | "items";

// ---- view models ----
export type SaleReturnSourceLine = {
  saleItemId: string;
  productId: string;
  code: string;
  name: string;
  unit: string;
  quantity: string; // originally sold (3 dp)
  returned: string; // already returned (3 dp)
  stock: string; // current stock in the sale warehouse (3 dp) — reference only
  netUnitPrice: string;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
};
export type SaleReturnSource = {
  id: string;
  reference: string;
  /** Grand Total − Paid − earlier returns: a return can't exceed it (refund/credit not built). */
  due: string;
  date: string; // YYYY-MM-DD (return date can't be earlier)
  dateLabel: string;
  customer: string;
  warehouse: string;
  subtotal: string;
  orderTaxAmount: string;
  orderTaxRate: string;
  discount: string;
  returnedSubtotal: string;
  currency: { code: string; symbol: string; right: boolean };
  lines: SaleReturnSourceLine[];
};
export type SaleReturnRow = {
  id: string;
  reference: string;
  saleRef: string;
  saleId: string;
  customerId: string;
  customer: string;
  warehouse: string;
  date: string; // YYYY-MM-DD
  dateLabel: string;
  grandTotal: string;
  currency: { code: string; symbol: string; right: boolean };
  inDefaultCurrency: boolean;
  createdOn: string;
};
