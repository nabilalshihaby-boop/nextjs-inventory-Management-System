import { z } from "zod";
import { PAYMENT_METHODS, makeTxDate, positiveMoneyWith } from "@/lib/cash-bank";
import { fmt } from "@/lib/i18n/config";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n";
import { toUnits } from "@/lib/transfers";

// Shared Supplier Payment rules (client + server). The browser sends only ids, the allocation
// amounts, the claimed total (checked against the exact sum), the method, date and text fields;
// dues, balances, currency, supplier identity of purchases and references are read on the server.

/** "SP_000001" — generated server-side from the AUTO_INCREMENT number. */
export const formatSupplierPaymentReference = (n: number) => `SP_${String(n).padStart(6, "0")}`;
/** Ledger purpose written for supplier payments (never selectable as a manual cash/bank purpose). */
export const SUPPLIER_PAYMENT_PURPOSE = "Supplier Payment";

const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);

/** Payment payload schema; messages are dictionary text (English by default). */
export function makeSupplierPaymentSchema(m: Dictionary["supplierPay"]["val"] = en.supplierPay.val, v0: Dictionary["sales"]["val"] = en.sales.val) {
  const money = (label: string) => positiveMoneyWith({ required: fmt(v0.required, { label }), format: fmt(v0.money, { label }), positive: fmt(m.positive, { label }) });
  const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
  return z
    .object({
      supplierId: id(m.chooseSupplier),
      paymentDate: makeTxDate({ required: v0.dateRequired, invalid: v0.dateInvalid, future: v0.dateFuture }),
      paymentMethod: z.enum(PAYMENT_METHODS, { error: m.chooseMethod }),
      cashBankAccountId: id(m.chooseAccount),
      /** The total the user saw; must equal Σ allocations exactly (protects against stale/forged totals). */
      amount: money(m.labels.amount),
      externalReference: z.string().trim().max(64, m.refTooLong).optional().default(""),
      notes: z.string().trim().max(2000, m.notesLong).optional().default(""),
      allocations: z
        .array(z.object({ purchaseId: id(m.choosePurchase), amount: money(m.labels.allocated) }), { error: m.selectOne })
        .min(1, m.selectOne)
        .max(100, m.maxPurchases),
    })
    .superRefine((v, ctx) => {
      const seen = new Set<string>();
      for (const a of v.allocations) {
        if (seen.has(a.purchaseId)) {
          ctx.addIssue({ code: "custom", path: ["allocations"], message: m.uniquePurchase });
          return;
        }
        seen.add(a.purchaseId);
      }
      const sum = v.allocations.reduce((s, a) => s + (MONEY.test(a.amount) ? toUnits(a.amount, 2) : BigInt(0)), BigInt(0));
      if (MONEY.test(v.amount) && sum !== toUnits(v.amount, 2)) {
        ctx.addIssue({ code: "custom", path: ["amount"], message: m.mismatch });
      }
    });
}
export const supplierPaymentInputSchema = makeSupplierPaymentSchema();

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
export type PayingAccount = { id: string; name: string; /** null when the viewer lacks finance.view */ balance: string | null; currencyId: string; currencyCode: string };
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
