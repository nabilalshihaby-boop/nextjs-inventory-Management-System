import { z } from "zod";
import { makeTxDate } from "@/lib/cash-bank";
import { fmt } from "@/lib/i18n/config";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n";
import { moneyOf, pctOf } from "@/lib/quotations";
import { toUnits } from "@/lib/transfers";

// Shared Purchase rules (client + server). Decimal values stay strings; totals are always
// recomputed on the server with lib/purchase-calc.ts (client values are never trusted).

export const PURCHASE_STATUSES = ["RECEIVED", "PENDING", "ORDERED"] as const;
export type PurchaseStatusValue = (typeof PURCHASE_STATUSES)[number];
/** Design order: Received, Pending, Ordered. */
export const PURCHASE_STATUS_LABEL: Record<PurchaseStatusValue, string> = { RECEIVED: "Received", PENDING: "Pending", ORDERED: "Ordered" };
/** Design Badge status map: received → success, pending/ordered → warning. */
export const PURCHASE_STATUS_TONE: Record<PurchaseStatusValue, string> = { RECEIVED: "success", PENDING: "warning", ORDERED: "warning" };

export type PaymentStatusValue = "PAID" | "PARTIAL" | "UNPAID" | "RETURNED";
export const PAYMENT_STATUS_LABEL: Record<PaymentStatusValue, string> = { PAID: "Paid", PARTIAL: "Partial", UNPAID: "Unpaid", RETURNED: "Returned" };
export const PAYMENT_STATUS_TONE: Record<PaymentStatusValue, string> = { PAID: "success", PARTIAL: "warning", UNPAID: "danger", RETURNED: "neutral" };
/**
 * Payment status against the amount actually owed: Grand Total − completed purchase returns.
 * A purchase whose whole remaining value was returned (nothing left to pay) is "Returned".
 */
export function paymentStatus(paid: string, grand: string, returned = "0.00"): PaymentStatusValue {
  const p = toUnits(paid, 2), net = toUnits(grand, 2) - toUnits(returned, 2);
  if (net <= BigInt(0) && toUnits(returned, 2) > BigInt(0) && p <= BigInt(0)) return "RETURNED";
  if (p <= BigInt(0) && net > BigInt(0)) return "UNPAID";
  return p >= net ? "PAID" : "PARTIAL";
}
/** Due = Grand Total − Paid − completed returns (never below 0). */
export function purchaseDue(grand: string, paid: string, returned: string): string {
  const d = toUnits(grand, 2) - toUnits(paid, 2) - toUnits(returned, 2);
  const v = d < BigInt(0) ? BigInt(0) : d;
  return `${v / BigInt(100)}.${String(v % BigInt(100)).padStart(2, "0")}`;
}

/** "PU_000001" — generated server-side from the AUTO_INCREMENT number. */
export const formatPurchaseReference = (n: number) => `PU_${String(n).padStart(6, "0")}`;
export const MAX_PURCHASE_ITEMS = 200;

const QTY_RE = /^\d{1,11}(\.\d{1,3})?$/;
const PCT_RE = /^\d{1,3}(\.\d{1,2})?$/;
const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);

type PurchaseVal = Dictionary["purchases"]["val"];
/** Line schema built with a message set (dictionary text; English by default). */
export function makePurchaseItemSchema(m: PurchaseVal = en.purchases.val) {
  return z
    .object({
      productId: id(m.chooseProduct),
      quantity: z
        .string({ error: m.qtyRequired })
        .trim()
        .refine((v) => QTY_RE.test(v), m.qtyFormat)
        .refine((v) => !QTY_RE.test(v) || toUnits(v, 3) > BigInt(0), m.qtyPositive),
      unitCost: moneyOf(m, m.labels.productCost),
      taxType: z.enum(["EXCLUSIVE", "INCLUSIVE"], { error: m.chooseTaxType }),
      taxRate: pctOf(m, m.labels.tax),
      discountType: z.enum(["FIXED", "PERCENTAGE"], { error: m.chooseDiscountType }),
      discountValue: moneyOf(m, m.labels.discount),
    })
    .superRefine((v, ctx) => {
      if (v.discountType === "PERCENTAGE" && !(PCT_RE.test(v.discountValue) && Number(v.discountValue) <= 100)) {
        ctx.addIssue({ code: "custom", path: ["discountValue"], message: m.discountPct });
      }
    });
}
export const purchaseItemSchema = makePurchaseItemSchema();

/** Create payload schema. Only ids, line inputs, order inputs, status, date and notes are accepted. */
export function makePurchaseSchema(m: PurchaseVal = en.purchases.val) {
  return z
    .object({
      purchaseDate: makeTxDate({ required: m.dateRequired, invalid: m.dateInvalid, future: m.dateFuture }),
      warehouseId: id(m.chooseWarehouse),
      supplierId: id(m.chooseSupplier),
      status: z.enum(PURCHASE_STATUSES, { error: m.chooseStatus }),
      orderTaxRate: pctOf(m, m.labels.orderTax),
      discount: moneyOf(m, m.labels.discount),
      shipping: moneyOf(m, m.labels.shipping),
      notes: z.string().trim().max(2000, m.notesLong).optional().default(""),
      items: z.array(makePurchaseItemSchema(m), { error: m.addItem }).min(1, m.addItem).max(MAX_PURCHASE_ITEMS, fmt(m.maxItems, { max: MAX_PURCHASE_ITEMS })),
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
export const purchaseInputSchema = makePurchaseSchema();

export type PurchaseInput = z.infer<typeof purchaseInputSchema>;
export type PurchaseField = "purchaseDate" | "warehouseId" | "supplierId" | "status" | "orderTaxRate" | "discount" | "shipping" | "notes" | "items";

// ---- view models ----
export type PurchaseProduct = { productId: string; code: string; name: string; cost: string; taxType: "EXCLUSIVE" | "INCLUSIVE"; taxRate: string; unit: string };
export type PurchaseStockLevel = { productId: string; warehouseId: string; quantity: string };
export type PurchaseOption = { value: string; label: string };
export type PurchaseRow = {
  id: string;
  reference: string;
  supplier: string;
  warehouse: string;
  status: PurchaseStatusValue;
  date: string; // YYYY-MM-DD (date filter)
  grandTotal: string; // raw 2-dp
  paid: string;
  due: string;
  paymentStatus: PaymentStatusValue;
  createdOn: string;
  /** The currency the purchase was recorded in (its stored snapshot). */
  currency: { code: string; symbol: string; right: boolean };
  /** True when it matches the current default currency (footer totals add only these). */
  inDefaultCurrency: boolean;
};
