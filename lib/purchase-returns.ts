import { z } from "zod";
import { transactionDateSchema } from "@/lib/cash-bank";
import { toUnits } from "@/lib/transfers";

// Shared Purchase Return rules (client + server). The browser only sends the purchase id, the
// purchase-line ids and quantities, the date and notes — everything else is read on the server.

/** "PR_000001" — generated server-side from the AUTO_INCREMENT number. */
export const formatPurchaseReturnReference = (n: number) => `PR_${String(n).padStart(6, "0")}`;

const QTY_RE = /^\d{1,11}(\.\d{1,3})?$/;
const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);

export const purchaseReturnInputSchema = z
  .object({
    returnDate: transactionDateSchema,
    purchaseId: id("Choose a received purchase"),
    notes: z.string().trim().max(2000, "Notes are too long").optional().default(""),
    items: z
      .array(
        z.object({
          purchaseItemId: id("Choose a valid purchase line"),
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
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    for (const i of v.items) {
      if (seen.has(i.purchaseItemId)) {
        ctx.addIssue({ code: "custom", path: ["items"], message: "Each purchase line can appear only once" });
        break;
      }
      seen.add(i.purchaseItemId);
    }
  });

export type PurchaseReturnInput = z.infer<typeof purchaseReturnInputSchema>;
export type PurchaseReturnField = "returnDate" | "purchaseId" | "notes" | "items";

// ---- view models ----
export type ReturnSourceLine = {
  purchaseItemId: string;
  productId: string;
  code: string;
  name: string;
  unit: string;
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
