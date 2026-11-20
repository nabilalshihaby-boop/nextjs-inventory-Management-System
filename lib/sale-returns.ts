import { z } from "zod";
import { transactionDateSchema } from "@/lib/cash-bank";
import { toUnits, fromUnits } from "@/lib/transfers";

// Shared Sales Return rules (client + server). The browser only sends the sale id, the sale-line
// ids and quantities, the date and notes — everything else (customer, warehouse, currency, product,
// price, tax, discount, returnable quantity, totals, reference, status) is read on the server.
// Amounts use the exact cumulative proration of lib/purchase-return-calc.ts on the sale's stored
// snapshot; shipping is never returned.

/** "SR_000001" — generated server-side from the AUTO_INCREMENT number (never reused). */
export const formatSaleReturnReference = (n: number) => `SR_${String(n).padStart(6, "0")}`;
export const SALE_RETURN_PDF_SOON = "Download PDF — coming soon";
export const SALE_RETURN_IMMUTABLE = "Completed sales returns can't be edited or deleted";

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

export const saleReturnInputSchema = z
  .object({
    returnDate: transactionDateSchema,
    saleId: id("Choose a completed sale"),
    notes: z.string().trim().max(2000, "Notes are too long").optional().default(""),
    items: z
      .array(
        z.object({
          saleItemId: id("Choose a valid sale line"),
          quantity: z
            .string({ error: "Quantity is required" })
            .trim()
            .refine((v) => QTY_RE.test(v), "Quantity must be a number with up to 3 decimal places")
            .refine((v) => !QTY_RE.test(v) || toUnits(v, 3) > BigInt(0), "Quantity must be greater than 0"),
        }),
        { error: "Add at least one return line" },
      )
      .min(1, "Enter a return quantity for at least one line")
      .max(200, "Up to 200 lines per return"),
  })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    for (const i of v.items) {
      if (seen.has(i.saleItemId)) {
        ctx.addIssue({ code: "custom", path: ["items"], message: "Each sale line can appear only once" });
        break;
      }
      seen.add(i.saleItemId);
    }
  });

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
