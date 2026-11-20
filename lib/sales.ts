import { z } from "zod";
import { transactionDateSchema } from "@/lib/cash-bank";
import { MAX_QUOTATION_ITEMS, calcQuotation, quotationItemSchema, type QuotationCurrency, type QuotationOption, type QuotationProduct, type QuotationStockLevel } from "@/lib/quotations";

// Shared Sale rules (client + server). The sale lines use the SAME line schema and the SAME exact
// calculation as quotations (lib/quotations.ts → lib/purchase-calc.ts), so a quotation converts to a
// sale with identical totals. Every total is recomputed on the server; client values are ignored.

export const SALE_STATUSES = ["COMPLETED", "PENDING"] as const;
export type SaleStatusValue = (typeof SALE_STATUSES)[number];
export const SALE_STATUS_LABEL: Record<SaleStatusValue, string> = { COMPLETED: "Completed", PENDING: "Pending" };
export const SALE_STATUS_TONE: Record<SaleStatusValue, string> = { COMPLETED: "success", PENDING: "warning" };

/** Customer payments aren't built: every sale is Unpaid (Paid 0, Due = Grand Total). */
export const PAYMENTS_SOON = "Customer payments — coming soon";
export const SALE_RETURN_SOON = "Sales Returns — coming soon";
export const SALE_PDF_SOON = "Download PDF — coming soon";

/** "SA_000001" — generated server-side from the AUTO_INCREMENT number (never reused). */
export const formatSaleReference = (n: number) => `SA_${String(n).padStart(6, "0")}`;
export const MAX_SALE_ITEMS = MAX_QUOTATION_ITEMS;
export const calcSale = calcQuotation;

const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);
const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
const PCT_RE = /^\d{1,3}(\.\d{1,2})?$/;
const money = (label: string) => z.string({ error: `${label} is required` }).trim().refine((v) => MONEY_RE.test(v), `${label} must be a number with up to 2 decimal places`);
const pct = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .refine((v) => PCT_RE.test(v) && Number(v) <= 100, `${label} must be a percentage between 0 and 100`);

/** Create / edit payload. Reference, currency, paid/due and every total are server-owned. */
export const saleInputSchema = z
  .object({
    saleDate: transactionDateSchema,
    warehouseId: id("Choose a warehouse"),
    customerId: id("Choose a customer"),
    status: z.enum(SALE_STATUSES, { error: "Choose a valid status" }),
    orderTaxRate: pct("Order tax"),
    discount: money("Discount"),
    shipping: money("Shipping"),
    notes: z.string().trim().max(2000, "Notes are too long").optional().default(""),
    items: z.array(quotationItemSchema, { error: "Add at least one order item" }).min(1, "Add at least one order item").max(MAX_SALE_ITEMS, `Up to ${MAX_SALE_ITEMS} products per sale`),
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

export type SaleInput = z.infer<typeof saleInputSchema>;
export type SaleField = "saleDate" | "warehouseId" | "customerId" | "status" | "orderTaxRate" | "discount" | "shipping" | "notes" | "items";

// ---- view models (form options are shared with quotations) ----
export type SaleProduct = QuotationProduct;
export type SaleStockLevel = QuotationStockLevel;
export type SaleOption = QuotationOption;
export type SaleCurrency = QuotationCurrency;
export type SaleDraft = {
  id: string;
  reference: string;
  saleDate: string;
  warehouseId: string;
  customerId: string;
  orderTaxRate: string;
  discount: string;
  shipping: string;
  notes: string;
  currency: SaleCurrency;
  quotationRef: string | null;
  lines: (SaleProduct & { quantity: string; unitPrice: string; discountType: "FIXED" | "PERCENTAGE"; discountValue: string })[];
};
export type SaleRow = {
  id: string;
  reference: string;
  customerId: string;
  customer: string;
  warehouse: string;
  status: SaleStatusValue;
  date: string;
  dateLabel: string;
  grandTotal: string;
  paid: string;
  due: string;
  quotationRef: string | null;
  createdOn: string;
  currency: SaleCurrency;
  inDefaultCurrency: boolean;
};
