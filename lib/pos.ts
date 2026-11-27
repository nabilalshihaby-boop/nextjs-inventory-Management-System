import { z } from "zod";
import type { ProductUnits } from "@/lib/unit-math";
import { PAYMENT_METHODS, positiveMoneySchema } from "@/lib/cash-bank";
import type { RegisterOverview } from "@/lib/register";
import type { CountDenomination } from "@/lib/denominations";

// POS checkout rules (client + server). The browser sends ONLY ids, quantities, the payment method,
// the receiving account, notes and an idempotency key. Prices, tax, totals, currency, the sale date
// and the paid amount are never accepted from the client — the server re-reads them.

export const MAX_POS_ITEMS = 100;
const QTY_RE = /^\d{1,11}(\.\d{1,3})?$/;
const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);

export const MAX_TENDERS = 5;
/** One payment of a (possibly split) checkout: method + receiving account + exact amount. */
export const posTenderSchema = z
  .object({
    paymentMethod: z.enum(PAYMENT_METHODS, { error: "Choose a payment method" }),
    cashBankAccountId: id("Choose the account the payment is deposited to"),
    amount: positiveMoneySchema("Payment amount"),
  })
  .strict();

export const posCheckoutSchema = z
  .object({
    /** Unique per checkout attempt; stored on the sale (unique) so a retry can never repeat the effects. */
    checkoutKey: z.string({ error: "Invalid checkout key" }).trim().regex(/^[A-Za-z0-9_-]{16,64}$/, "Invalid checkout key"),
    customerId: id("Choose a customer"),
    warehouseId: id("Choose a warehouse"),
    /** 1-5 payments whose amounts must add up to EXACTLY the server-calculated Grand Total (no change, no partial). */
    tenders: z.array(posTenderSchema, { error: "Add at least one payment" }).min(1, "Add at least one payment").max(MAX_TENDERS, `Up to ${MAX_TENDERS} payments per sale`),
    notes: z.string().trim().max(2000, "Notes are too long").optional().default(""),
    /** The held order this cart was resumed from (consumed by this checkout); optional. */
    heldOrderId: z.string().trim().max(64).optional().default(""),
    /** The revision of that held order when it was resumed; any other value than the stored one is refused. */
    heldRevision: z.number("posTx.held.conflict").int("posTx.held.conflict").min(1, "posTx.held.conflict").max(2147483647, "posTx.held.conflict").optional(),
    /** The cashier chose the configured Walk-in Customer. NOT a value: the server re-reads the setting and
     *  refuses the checkout if it no longer names exactly this customer (stale/changed configuration). */
    walkIn: z.boolean().optional().default(false),
    items: z
      .array(
        z
          .object({
            productId: id("Choose a valid product"),
            /** The selected sale unit (selector only): factor, base quantity and price are resolved on the server. */
            unitId: z.string().trim().max(64).optional().default(""),
            /** Resumed carts: the id of the held line this is. The server only COMPARES it with the stored lines (it grants nothing). */
            heldLineId: z.string().trim().max(64).optional(),
            quantity: z
              .string({ error: "Quantity is required" })
              .trim()
              .refine((v) => QTY_RE.test(v), "Quantity must be a number with up to 3 decimal places")
              .refine((v) => !QTY_RE.test(v) || Number(v) > 0, "Quantity must be greater than 0"),
          })
          .strict(),
        { error: "Add at least one product to the cart" },
      )
      .min(1, "Add at least one product to the cart")
      .max(MAX_POS_ITEMS, `Up to ${MAX_POS_ITEMS} products per checkout`),
  })
  .strict()
  .superRefine((v, ctx) => {
    // A line is a product UNIT: the same product may appear once per unit (Water x 1 Box + Water x 2 Piece). Two identical
    // (product, unit) lines are a tampered or buggy cart; blank/explicit spellings of one unit are compared again after the
    // server resolves each line's unit (see posCheckout).
    const seen = new Set<string>();
    for (const i of v.items) {
      const key = `${i.productId}|${i.unitId}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", path: ["items"], message: "posTx.val.dupProduct" });
        return;
      }
      seen.add(key);
    }
    // Duplicate account + method rows are ambiguous: rejected (the cashier merges them into one amount).
    const t = new Set<string>();
    for (const x of v.tenders) {
      const k = `${x.cashBankAccountId}|${x.paymentMethod}`;
      if (t.has(k)) {
        ctx.addIssue({ code: "custom", path: ["tenders"], message: "posTx.val.dupTender" });
        return;
      }
      t.add(k);
    }
  });

export type PosCheckoutInput = z.infer<typeof posCheckoutSchema>;

// ---- view models ----
export type PosProduct = {
  id: string;
  code: string;
  name: string;
  price: string;
  taxType: "EXCLUSIVE" | "INCLUSIVE";
  taxRate: string;
  unit: string;
  /** The product's units (display only: factor, base quantity and price are resolved on the server). */
  unitInfo: ProductUnits;
  category: string;
  brand: string;
  image: string | null;
  /** Deactivated, but still on one of this user's held orders: only that held line can use it (never the grid, search or scanner). */
  inactive?: boolean;
};
export type PosData = {
  /** Only what the screen needs up front; other customers are found through the search. */
  walkInCustomer: { id: string; name: string } | null;
  hasCustomers: boolean;
  warehouses: { id: string; name: string }[];
  products: PosProduct[];
  /** product × warehouse stock (display only; checkout re-reads it under the transaction). */
  stock: { productId: string; warehouseId: string; quantity: string }[];
  /** ACTIVE accounts in the sale currency only. */
  accounts: { id: string; name: string; type: "CASH" | "BANK" }[];
  categories: string[];
  brands: string[];
  currency: { code: string; symbol: string; right: boolean } | null;
  /** The signed-in user's name, shown on the lock screen. */
  userName: string;
  /** Open register sessions + recent history (display; checkout and Close Register re-check on the server). */
  registers: RegisterOverview;
  /** Active denominations of the sale currency for counting the drawer at close (empty = manual counted cash). */
  denominations: CountDenomination[];
  /** The Owner configures denominations; ADMIN is told to ask the Owner. */
  isOwner: boolean;
  /** Whether the signed-in user has a POS PIN (a boolean only - never the hash). */
  hasPin: boolean;
  /** The configured POS Walk-in Customer (a real customer id) or null when not configured. */
  walkInCustomerId: string | null;
  /** OWNER can configure it in System Settings; others are told to ask the Owner. */
  canConfigureWalkIn: boolean;
};
