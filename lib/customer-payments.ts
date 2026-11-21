import { z } from "zod";
import { PAYMENT_METHODS, makeTxDate, positiveMoneyWith } from "@/lib/cash-bank";
import { fmt } from "@/lib/i18n/config";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n";
import { toUnits } from "@/lib/transfers";

// Shared Customer Payment rules (client + server). The browser sends only ids, the allocation
// amounts, the claimed total (checked against the exact sum), the method, date and text fields;
// dues, paid, returns, balances, currency, sale ownership and references are read on the server.

/** "CP_000001" — generated server-side from the AUTO_INCREMENT number (never reused). */
export const formatCustomerPaymentReference = (n: number) => `CP_${String(n).padStart(6, "0")}`;
/** Ledger deposit source written for customer payments (never selectable as a manual deposit). */
export const CUSTOMER_PAYMENT_PURPOSE = "Customer Collection";

const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);
const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;

/** Payment payload schema; messages are dictionary text (English by default). */
export function makeCustomerPaymentSchema(m: Dictionary["custPay"]["val"] = en.custPay.val, v0: Dictionary["sales"]["val"] = en.sales.val) {
  const money = (label: string) => positiveMoneyWith({ required: fmt(v0.required, { label }), format: fmt(v0.money, { label }), positive: fmt(m.positive, { label }) });
  return z
    .object({
      customerId: id(m.chooseCustomer),
      paymentDate: makeTxDate({ required: v0.dateRequired, invalid: v0.dateInvalid, future: v0.dateFuture }),
      paymentMethod: z.enum(PAYMENT_METHODS, { error: m.chooseMethod }),
      cashBankAccountId: id(m.chooseAccount),
      /** The total the user saw; must equal Σ allocations exactly (protects against stale/forged totals). */
      amount: money(m.labels.amount),
      externalReference: z.string().trim().max(64, m.refTooLong).optional().default(""),
      notes: z.string().trim().max(2000, m.notesLong).optional().default(""),
      allocations: z
        .array(z.object({ saleId: id(m.chooseSale), amount: money(m.labels.allocated) }).strict(), { error: m.selectOne })
        .min(1, m.selectOne)
        .max(100, m.maxSales),
    })
    .strict()
    .superRefine((v, ctx) => {
      const seen = new Set<string>();
      for (const a of v.allocations) {
        if (seen.has(a.saleId)) {
          ctx.addIssue({ code: "custom", path: ["allocations"], message: m.uniqueSale });
          return;
        }
        seen.add(a.saleId);
      }
      const sum = v.allocations.reduce((s, a) => s + (MONEY_RE.test(a.amount) ? toUnits(a.amount, 2) : BigInt(0)), BigInt(0));
      if (MONEY_RE.test(v.amount) && sum !== toUnits(v.amount, 2)) {
        ctx.addIssue({ code: "custom", path: ["amount"], message: m.mismatch });
      }
    });
}
export const customerPaymentInputSchema = makeCustomerPaymentSchema();

export type CustomerPaymentInput = z.infer<typeof customerPaymentInputSchema>;
export type CustomerPaymentField = "customerId" | "paymentDate" | "paymentMethod" | "cashBankAccountId" | "amount" | "externalReference" | "notes" | "allocations";

// ---- view models ----
export type PayableSale = {
  id: string;
  customerId: string;
  reference: string;
  date: string; // YYYY-MM-DD (payment can't be earlier)
  dateLabel: string;
  status: string; // always "Completed" (only completed sales are payable)
  currencyId: string;
  grandTotal: string;
  paid: string;
  returned: string;
  due: string;
};
export type ReceivingAccount = { id: string; name: string; balance: string; currencyId: string; currencyCode: string };
export type PaymentCurrency = { id: string; code: string; symbol: string; right: boolean };
export type CustomerPaymentRow = {
  id: string;
  reference: string;
  date: string; // YYYY-MM-DD
  dateLabel: string;
  customerId: string;
  customer: string;
  method: string;
  account: string;
  amount: string;
  appliedTo: { reference: string; saleId: string; amount: string }[];
  externalReference: string;
  notes: string;
  ledgerReference: string;
  createdBy: string;
  createdOn: string;
  currency: { code: string; symbol: string; right: boolean };
  inDefaultCurrency: boolean;
};
