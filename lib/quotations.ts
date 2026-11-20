import { z } from "zod";
import { transactionDateSchema } from "@/lib/cash-bank";
import { calcOrder, type LineInput, type OrderResult } from "@/lib/purchase-calc";
import { toUnits } from "@/lib/transfers";

// Shared Quotation rules (client + server). A quotation is a commercial offer only — it never
// moves stock, money, ledger rows, purchase dues or customer balances. Values stay decimal strings;
// every total is recomputed on the server with the same exact calculation as the preview.

export const QUOTATION_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"] as const;
export type QuotationStatusValue = (typeof QUOTATION_STATUSES)[number];
export const QUOTATION_STATUS_LABEL: Record<QuotationStatusValue, string> = { DRAFT: "Draft", SENT: "Sent", ACCEPTED: "Accepted", REJECTED: "Rejected", EXPIRED: "Expired" };
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
export const TRANSITION_LABEL: Record<QuotationStatusValue, string> = { DRAFT: "Draft", SENT: "Mark as Sent", ACCEPTED: "Mark as Accepted", REJECTED: "Mark as Rejected", EXPIRED: "Mark as Expired" };
export const canTransition = (from: QuotationStatusValue, to: QuotationStatusValue) => QUOTATION_TRANSITIONS[from].includes(to);
/** Only drafts may be edited or deleted. */
export const isEditable = (s: QuotationStatusValue) => s === "DRAFT";

/** Why "Create Sale" isn't available for a quotation (null = it can be converted now). */
export function convertBlockedReason(status: QuotationStatusValue, saleRef: string | null): string | null {
  if (saleRef) return `Already converted to sale ${saleRef}`;
  if (status !== "ACCEPTED") return "Only accepted quotations can be converted to a sale";
  return null;
}
export const QUOTATION_PDF_SOON = "Download PDF — coming soon";

/** "QU_000001" — generated server-side from the AUTO_INCREMENT number (never reused). */
export const formatQuotationReference = (n: number) => `QU_${String(n).padStart(6, "0")}`;
export const MAX_QUOTATION_ITEMS = 200;

const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
const QTY_RE = /^\d{1,11}(\.\d{1,3})?$/;
const PCT_RE = /^\d{1,3}(\.\d{1,2})?$/;
const money = (label: string) => z.string({ error: `${label} is required` }).trim().refine((v) => MONEY_RE.test(v), `${label} must be a number with up to 2 decimal places`);
const pct = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .refine((v) => PCT_RE.test(v) && Number(v) <= 100, `${label} must be a percentage between 0 and 100`);
const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);

export const quotationItemSchema = z
  .object({
    productId: id("Choose a valid product"),
    quantity: z
      .string({ error: "Quantity is required" })
      .trim()
      .refine((v) => QTY_RE.test(v), "Quantity must be a number with up to 3 decimal places")
      .refine((v) => !QTY_RE.test(v) || toUnits(v, 3) > BigInt(0), "Quantity must be greater than 0"),
    unitPrice: money("Product price"),
    taxType: z.enum(["EXCLUSIVE", "INCLUSIVE"], { error: "Choose a tax type" }),
    taxRate: pct("Tax"),
    discountType: z.enum(["FIXED", "PERCENTAGE"], { error: "Choose a discount type" }),
    discountValue: money("Discount"),
  })
  .superRefine((v, ctx) => {
    if (v.discountType === "PERCENTAGE" && !(PCT_RE.test(v.discountValue) && Number(v.discountValue) <= 100)) {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Discount percentage must be between 0 and 100" });
    }
  });

/** Create / edit payload. Status, reference, currency and every total are server-owned. */
export const quotationInputSchema = z
  .object({
    quotationDate: transactionDateSchema,
    warehouseId: id("Choose a warehouse"),
    customerId: id("Choose a customer"),
    orderTaxRate: pct("Order tax"),
    discount: money("Discount"),
    shipping: money("Shipping"),
    notes: z.string().trim().max(2000, "Notes are too long").optional().default(""),
    items: z.array(quotationItemSchema, { error: "Add at least one order item" }).min(1, "Add at least one order item").max(MAX_QUOTATION_ITEMS, `Up to ${MAX_QUOTATION_ITEMS} products per quotation`),
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
