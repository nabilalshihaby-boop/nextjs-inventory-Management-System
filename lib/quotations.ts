import { z } from "zod";
import { makeTxDate } from "@/lib/cash-bank";
import { calcOrder, type LineInput, type OrderResult } from "@/lib/purchase-calc";
import { toUnits } from "@/lib/transfers";
import { fmt } from "@/lib/i18n/config";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n";

// Shared Quotation rules (client + server). A quotation is a commercial offer only — it never
// moves stock, money, ledger rows, purchase dues or customer balances. Values stay decimal strings;
// every total is recomputed on the server with the same exact calculation as the preview.

export const QUOTATION_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"] as const;
export type QuotationStatusValue = (typeof QUOTATION_STATUSES)[number];
/** Badge tones (design: Sent → info-like, Pending → warning). */
export const QUOTATION_STATUS_TONE: Record<QuotationStatusValue, string> = { DRAFT: "warning", SENT: "info", ACCEPTED: "success", REJECTED: "danger", EXPIRED: "neutral" };

/**
 * The only status changes allowed (server-enforced with a conditional update on the current status).
 * DRAFT → SENT; SENT → ACCEPTED | REJECTED | EXPIRED. Accepted/Rejected/Expired are final here.
 */
export const QUOTATION_TRANSITIONS: Record<QuotationStatusValue, readonly QuotationStatusValue[]> = {
  DRAFT: ["SENT"],
  SENT: ["ACCEPTED", "REJECTED", "EXPIRED"],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
};
export const canTransition = (from: QuotationStatusValue, to: QuotationStatusValue) => QUOTATION_TRANSITIONS[from].includes(to);
/** Only drafts may be edited or deleted. */
export const isEditable = (s: QuotationStatusValue) => s === "DRAFT";

/** Why "Create Sale" isn't available for a quotation: a dictionary key (quotations.block.*) or null when it can be converted now. */
export function convertBlockedReason(status: QuotationStatusValue, saleRef: string | null): { key: string; vars?: Record<string, string> } | null {
  if (saleRef) return { key: "quotations.block.converted", vars: { sale: saleRef } };
  if (status !== "ACCEPTED") return { key: "quotations.block.notAccepted" };
  return null;
}

/** "QU_000001" — generated server-side from the AUTO_INCREMENT number (never reused). */
export const formatQuotationReference = (n: number) => `QU_${String(n).padStart(6, "0")}`;
export const MAX_QUOTATION_ITEMS = 200;

const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
const QTY_RE = /^\d{1,11}(\.\d{1,3})?$/;
const PCT_RE = /^\d{1,3}(\.\d{1,2})?$/;
/** Validation message set (dictionary text for localized modules; English by default). */
export type ValMsgs = Dictionary["sales"]["val"];
const lab = (m: ValMsgs, k: "productPrice" | "tax" | "discount" | "orderTax" | "shipping") => m.labels[k];
type MoneyMsgs = { required: string; money: string; pct: string };
const moneyOf = (m: MoneyMsgs, label: string) => z.string({ error: fmt(m.required, { label }) }).trim().refine((v) => MONEY_RE.test(v), fmt(m.money, { label }));
const pctOf = (m: MoneyMsgs, label: string) =>
  z
    .string({ error: fmt(m.required, { label }) })
    .trim()
    .refine((v) => PCT_RE.test(v) && Number(v) <= 100, fmt(m.pct, { label }));
const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);

/** The sale/quotation line schema built with a message set. */
export function makeItemSchema(m: ValMsgs = en.sales.val) {
  return z
    .object({
      productId: id(m.chooseProduct),
      quantity: z
        .string({ error: m.qtyRequired })
        .trim()
        .refine((v) => QTY_RE.test(v), m.qtyFormat)
        .refine((v) => !QTY_RE.test(v) || toUnits(v, 3) > BigInt(0), m.qtyPositive),
      unitPrice: moneyOf(m, lab(m, "productPrice")),
      taxType: z.enum(["EXCLUSIVE", "INCLUSIVE"], { error: m.chooseTaxType }),
      taxRate: pctOf(m, lab(m, "tax")),
      discountType: z.enum(["FIXED", "PERCENTAGE"], { error: m.chooseDiscountType }),
      discountValue: moneyOf(m, lab(m, "discount")),
    })
    .superRefine((v, ctx) => {
      if (v.discountType === "PERCENTAGE" && !(PCT_RE.test(v.discountValue) && Number(v.discountValue) <= 100)) {
        ctx.addIssue({ code: "custom", path: ["discountValue"], message: m.discountPct });
      }
    });
}
export const quotationItemSchema = makeItemSchema();
export { moneyOf, pctOf };

/** Create / edit payload schema. Status, reference, currency and every total are server-owned. Messages are dictionary text. */
export function makeQuotationSchema(m: Dictionary["quotations"]["val"] = en.quotations.val) {
  return z
    .object({
      quotationDate: makeTxDate({ required: m.dateRequired, invalid: m.dateInvalid, future: m.dateFuture }),
      warehouseId: id(m.chooseWarehouse),
      customerId: id(m.chooseCustomer),
      orderTaxRate: pctOf(m, m.labels.orderTax),
      discount: moneyOf(m, m.labels.discount),
      shipping: moneyOf(m, m.labels.shipping),
      notes: z.string().trim().max(2000, m.notesLong).optional().default(""),
      items: z.array(makeItemSchema(m as unknown as ValMsgs), { error: m.addItem }).min(1, m.addItem).max(MAX_QUOTATION_ITEMS, fmt(m.maxItems, { max: MAX_QUOTATION_ITEMS })),
    })
    .superRefine((v, ctx) => {
      const seen = new Set<string>();
      for (const i of v.items) {
        if (seen.has(i.productId)) {
          ctx.addIssue({ code: "custom", path: ["items"], message: m.uniqueProduct });
          break;
        }
        seen.add(i.productId);
      }
    });
}
export const quotationInputSchema = makeQuotationSchema();

export type QuotationInput = z.infer<typeof quotationInputSchema>;
export type QuotationField = "quotationDate" | "warehouseId" | "customerId" | "orderTaxRate" | "discount" | "shipping" | "notes" | "items";
export type QuotationLineInput = Pick<QuotationInput["items"][number], "quantity" | "unitPrice" | "taxType" | "taxRate" | "discountType" | "discountValue">;

/** The exact totals (same function for the browser preview and the server). */
export function calcQuotation(lines: QuotationLineInput[], o: { orderTaxRate: string; discount: string; shipping: string }): OrderResult {
  const asLine = (l: QuotationLineInput): LineInput => ({ quantity: l.quantity, unitCost: l.unitPrice, taxType: l.taxType, taxRate: l.taxRate, discountType: l.discountType, discountValue: l.discountValue });
  return calcOrder(lines.map(asLine), o);
}

// ---- view models ----
export type QuotationProduct = { productId: string; code: string; name: string; price: string; taxType: "EXCLUSIVE" | "INCLUSIVE"; taxRate: string; unit: string };
export type QuotationStockLevel = { productId: string; warehouseId: string; quantity: string };
export type QuotationOption = { value: string; label: string };
export type QuotationCurrency = { code: string; symbol: string; right: boolean };
/** Existing values when editing a draft. */
export type QuotationDraft = {
  id: string;
  reference: string;
  quotationDate: string;
  warehouseId: string;
  customerId: string;
  orderTaxRate: string;
  discount: string;
  shipping: string;
  notes: string;
  currency: QuotationCurrency;
  lines: (QuotationProduct & { quantity: string; unitPrice: string; discountType: "FIXED" | "PERCENTAGE"; discountValue: string })[];
};
export type QuotationRow = {
  id: string;
  reference: string;
  customerId: string;
  customer: string;
  warehouse: string;
  status: QuotationStatusValue;
  date: string; // YYYY-MM-DD (date filter)
  dateLabel: string;
  grandTotal: string;
  createdOn: string;
  currency: QuotationCurrency;
  inDefaultCurrency: boolean;
  /** The sale created from this quotation, if any. */
  sale: { id: string; reference: string } | null;
};
