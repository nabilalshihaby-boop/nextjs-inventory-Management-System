import { z } from "zod";
import { transactionDateSchema } from "@/lib/cash-bank";
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

export const purchaseItemSchema = z
  .object({
    productId: id("Choose a valid product"),
    quantity: z
      .string({ error: "Quantity is required" })
      .trim()
      .refine((v) => QTY_RE.test(v), "Quantity must be a number with up to 3 decimal places")
      .refine((v) => !QTY_RE.test(v) || toUnits(v, 3) > BigInt(0), "Quantity must be greater than 0"),
    unitCost: money("Product cost"),
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

/** Create payload. Only ids, line inputs, order inputs, status, date and notes are accepted. */
export const purchaseInputSchema = z
  .object({
    purchaseDate: transactionDateSchema,
    warehouseId: id("Choose a warehouse"),
    supplierId: id("Choose a supplier"),
    status: z.enum(PURCHASE_STATUSES, { error: "Choose a valid status" }),
    orderTaxRate: pct("Order tax"),
    discount: money("Discount"),
    shipping: money("Shipping"),
    notes: z.string().trim().max(2000, "Notes are too long").optional().default(""),
    items: z.array(purchaseItemSchema, { error: "Add at least one order item" }).min(1, "Add at least one order item").max(MAX_PURCHASE_ITEMS, `Up to ${MAX_PURCHASE_ITEMS} products per purchase`),
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
