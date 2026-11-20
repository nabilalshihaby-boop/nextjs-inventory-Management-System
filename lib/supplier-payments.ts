import { z } from "zod";
import { PAYMENT_METHODS, positiveMoneySchema, transactionDateSchema } from "@/lib/cash-bank";
import { toUnits } from "@/lib/transfers";

// Shared Supplier Payment rules (client + server). The browser sends only ids, the allocation
// amounts, the claimed total (checked against the exact sum), the method, date and text fields;
// dues, balances, currency, supplier identity of purchases and references are read on the server.

/** "SP_000001" — generated server-side from the AUTO_INCREMENT number. */
export const formatSupplierPaymentReference = (n: number) => `SP_${String(n).padStart(6, "0")}`;
/** Ledger purpose written for supplier payments (never selectable as a manual cash/bank purpose). */
export const SUPPLIER_PAYMENT_PURPOSE = "Supplier Payment";

const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);

export const supplierPaymentInputSchema = z
  .object({
    supplierId: id("Choose a supplier"),
    paymentDate: transactionDateSchema,
    paymentMethod: z.enum(PAYMENT_METHODS, { error: "Choose a payment method" }),
    cashBankAccountId: id("Choose the account the payment is made from"),
    /** The total the user saw; must equal Σ allocations exactly (protects against stale/forged totals). */
    amount: positiveMoneySchema("Amount"),
    externalReference: z.string().trim().max(64, "Reference is too long").optional().default(""),
    notes: z.string().trim().max(2000, "Notes are too long").optional().default(""),
    allocations: z
      .array(z.object({ purchaseId: id("Choose a valid purchase"), amount: positiveMoneySchema("Allocated amount") }), { error: "Select at least one purchase to pay" })
      .min(1, "Select at least one purchase to pay")
      .max(100, "Up to 100 purchases per payment"),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    for (const a of v.allocations) {
      if (seen.has(a.purchaseId)) {
        ctx.addIssue({ code: "custom", path: ["allocations"], message: "Each purchase can be allocated only once" });
        return;
      }
      seen.add(a.purchaseId);
    }
    const sum = v.allocations.reduce((s, a) => s + (/^\d{1,12}(\.\d{1,2})?$/.test(a.amount) ? toUnits(a.amount, 2) : BigInt(0)), BigInt(0));
    if (/^\d{1,12}(\.\d{1,2})?$/.test(v.amount) && sum !== toUnits(v.amount, 2)) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "The payment amount must equal the sum of the allocations" });
    }
  });

export type SupplierPaymentInput = z.infer<typeof supplierPaymentInputSchema>;
export type SupplierPaymentField = "supplierId" | "paymentDate" | "paymentMethod" | "cashBankAccountId" | "amount" | "externalReference" | "notes" | "allocations";

// ---- view models ----
export type PayablePurchase = {
  id: string;
  supplierId: string;
  reference: string;
  date: string; // YYYY-MM-DD (payment can't be earlier)
  dateLabel: string;
  status: string; // Received / Pending / Ordered
  currencyId: string;
  grandTotal: string;
  paid: string;
  returned: string;
  due: string;
};
export type PayingAccount = { id: string; name: string; balance: string; currencyId: string; currencyCode: string };
export type PaymentCurrency = { id: string; code: string; symbol: string; right: boolean };
export type SupplierPaymentRow = {
  id: string;
  reference: string;
  date: string; // YYYY-MM-DD
  dateLabel: string;
  supplierId: string;
  supplier: string;
  method: string;
  account: string;
  amount: string;
  appliedTo: { reference: string; purchaseId: string; amount: string }[];
  externalReference: string;
  notes: string;
  ledgerReference: string;
  createdBy: string;
  createdOn: string;
  currency: { code: string; symbol: string; right: boolean };
  inDefaultCurrency: boolean;
};
