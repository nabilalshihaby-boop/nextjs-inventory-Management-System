import { z } from "zod";
import type { ProductUnits } from "@/lib/unit-math";
import { makeTxDate } from "@/lib/cash-bank";
import { fmt } from "@/lib/i18n/config";
import { en } from "@/lib/i18n/dictionaries/en";
import type { PaymentStatusValue } from "@/lib/purchases";
import { MAX_QUOTATION_ITEMS, calcQuotation, makeItemSchema, moneyOf, pctOf, type ValMsgs, type QuotationCurrency, type QuotationOption, type QuotationProduct, type QuotationStockLevel } from "@/lib/quotations";

// Shared Sale rules (client + server). The sale lines use the SAME line schema and the SAME exact
// calculation as quotations (lib/quotations.ts → lib/purchase-calc.ts), so a quotation converts to a
// sale with identical totals. Every total is recomputed on the server; client values are ignored.

export const SALE_STATUSES = ["COMPLETED", "PENDING"] as const;
export type SaleStatusValue = (typeof SALE_STATUSES)[number];
export const SALE_STATUS_TONE: Record<SaleStatusValue, string> = { COMPLETED: "success", PENDING: "warning" };

/** Why "Record Payment" isn't available for a sale: a dictionary key (sales.block.*) or null when it can be paid now. */
export function paymentBlockedReason(status: SaleStatusValue, due: string): string | null {
  if (status !== "COMPLETED") return "sales.block.payOnlyCompleted";
  if (!/[1-9]/.test(due)) return "sales.block.payNothingLeft";
  return null;
}

/** Why "Create Sale Return" isn't available: a dictionary key (sales.block.*) or null when it can be returned now. */
export function returnBlockedReason(status: SaleStatusValue, due: string, fullyReturned: boolean): string | null {
  if (status !== "COMPLETED") return "sales.block.returnOnlyCompleted";
  if (fullyReturned) return "sales.block.returnAll";
  if (!/[1-9]/.test(due)) return "sales.block.returnNothingUnpaid";
  return null;
}

/** "SA_000001" — generated server-side from the AUTO_INCREMENT number (never reused). */
export const formatSaleReference = (n: number) => `SA_${String(n).padStart(6, "0")}`;
export const MAX_SALE_ITEMS = MAX_QUOTATION_ITEMS;
export const calcSale = calcQuotation;

const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);

/** Create / edit payload schema. Reference, currency, paid/due and every total are server-owned. Messages are dictionary text. */
export function makeSaleSchema(m: ValMsgs = en.sales.val) {
  return z
    .object({
      saleDate: makeTxDate({ required: m.dateRequired, invalid: m.dateInvalid, future: m.dateFuture }),
      warehouseId: id(m.chooseWarehouse),
      customerId: id(m.chooseCustomer),
      status: z.enum(SALE_STATUSES, { error: m.chooseStatus }),
      orderTaxRate: pctOf(m, m.labels.orderTax),
      discount: moneyOf(m, m.labels.discount),
      shipping: moneyOf(m, m.labels.shipping),
      notes: z.string().trim().max(2000, m.notesLong).optional().default(""),
      items: z.array(makeItemSchema(m), { error: m.addItem }).min(1, m.addItem).max(MAX_SALE_ITEMS, fmt(m.maxItems, { max: MAX_SALE_ITEMS })),
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
export const saleInputSchema = makeSaleSchema();

export type SaleInput = z.infer<typeof saleInputSchema>;
export type SaleField = "saleDate" | "warehouseId" | "customerId" | "status" | "orderTaxRate" | "discount" | "shipping" | "notes" | "items";

// ---- view models (form options are shared with quotations) ----
/** A product choice for the sale form: price/tax/stock like quotations, plus its units (the line unit + factor decide the price). */
export type SaleProduct = QuotationProduct & { unitInfo: ProductUnits };
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
  lines: (SaleProduct & { unitId: string; quantity: string; unitPrice: string; discountType: "FIXED" | "PERCENTAGE"; discountValue: string })[];
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
  /** Σ completed sales-return grand totals. */
  returned: string;
  /** max(0, Grand Total − Paid − returned). */
  due: string;
  paymentStatus: PaymentStatusValue;
  /** Distinct methods of the customer payments allocated to this sale (Payment Type). */
  paymentTypes: string[];
  /** null when a sales return can be created now, otherwise the reason. */
  returnBlocked: string | null;
  quotationRef: string | null;
  createdOn: string;
  currency: SaleCurrency;
  inDefaultCurrency: boolean;
};
