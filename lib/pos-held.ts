import { z } from "zod";
import { PAYMENT_METHODS } from "@/lib/cash-bank";
import { MAX_POS_ITEMS, MAX_TENDERS } from "@/lib/pos";

// Held POS orders (client + server). A hold stores only ids, quantities, the selected method /
// account / customer / warehouse and notes. Everything else (names, prices, stock, validity) is
// re-read on the server when the order is listed, resumed, or checked out.

const QTY_RE = /^\d{1,11}(\.\d{1,3})?$/;
const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);
const optId = z.string().trim().max(64).optional().default("");

export const holdOrderSchema = z
  .object({
    /** Idempotency key of this Hold action (a double-click / retry creates ONE held order). */
    holdKey: z.string({ error: "Invalid hold key" }).trim().regex(/^[A-Za-z0-9_-]{16,64}$/, "Invalid hold key"),
    /** Present when the cart was resumed from a held order: that order is updated, not duplicated. */
    heldOrderId: optId,
    /** With heldOrderId: the order's revision as resumed (a stale one is refused). */
    heldRevision: z.number("posTx.held.conflict").int("posTx.held.conflict").min(1, "posTx.held.conflict").max(2147483647, "posTx.held.conflict").optional(),
    customerId: optId,
    warehouseId: optId,
    /** Draft payment rows (may be half-filled). Checkout re-validates everything. */
    tenders: z
      .array(
        z
          .object({
            paymentMethod: z.union([z.enum(PAYMENT_METHODS), z.literal("")]),
            cashBankAccountId: z.string().trim().max(64),
            amount: z.union([z.literal(""), z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, "Amount must be a number with up to 2 decimal places")]),
          })
          .strict(),
      )
      .max(MAX_TENDERS, `Up to ${MAX_TENDERS} payments per sale`)
      .optional()
      .default([]),
    notes: z.string().trim().max(2000, "Notes are too long").optional().default(""),
    items: z
      .array(
        z
          .object({
            productId: id("Choose a valid product"),
            /** The selected sale unit (selector only; validated against the product again at hold and at checkout). */
            unitId: z.string().trim().max(64).optional().default(""),
            /** Re-holding a resumed cart: the id of the stored line this is (verified by the server). Absent = a new line. */
            heldLineId: z.string().trim().min(1, "posTx.held.lineIdentity").max(64, "posTx.held.lineIdentity").optional(),
            quantity: z
              .string({ error: "Quantity is required" })
              .trim()
              .refine((v) => QTY_RE.test(v), "Quantity must be a number with up to 3 decimal places")
              .refine((v) => !QTY_RE.test(v) || Number(v) > 0, "Quantity must be greater than 0"),
          })
          .strict(),
        { error: "Add at least one product to hold" },
      )
      .min(1, "Add at least one product to hold")
      .max(MAX_POS_ITEMS, `Up to ${MAX_POS_ITEMS} products per order`),
  })
  .strict();
export type HoldOrderInput = z.infer<typeof holdOrderSchema>;

export const heldIdSchema = z.string({ error: "Held order not found" }).trim().min(1, "Held order not found").max(64, "Held order not found");
export const heldRevisionSchema = z.number().int().min(1).max(2147483647);
export const unlockSchema = z.object({ password: z.string().min(1, "Enter your password").max(200) }).strict();

// ---- view models ----
export type HeldOrderSummary = { /** Sent back when discarding: a newer order is never discarded by an old list. */ revision: number; id: string; reference: string; createdOn: string; lines: number; quantity: string; customerName: string | null; total: string };
/** `inactive` = the product was deactivated after the order was held: the line may be kept unchanged (at `heldPrice`) or removed. */
export type ResumedLine = { productId: string; code: string; name: string; quantity: string; unitId: string; missing: boolean; inactive: boolean; heldPrice: string; /** The held line (compared at checkout) and its tax snapshot ("" = no complete snapshot). */ id: string; taxType: "EXCLUSIVE" | "INCLUSIVE" | ""; taxRate: string; /** The unit snapshot taken at hold time ("" = held before snapshots existed). */ unitName: string; unitFactor: string; /** The held unit is unknown or can no longer be sold: the cashier must choose one before holding again. */ needsUnit: boolean };
export type ResumedOrder = {
  id: string;
  /** Sent back with the re-hold / checkout / discard of this cart. */
  revision: number;
  reference: string;
  customerId: string;
  warehouseId: string;
  /** Saved payment rows; an account that is gone/inactive/in another currency comes back blank. */
  tenders: { paymentMethod: string; cashBankAccountId: string; amount: string }[];
  notes: string;
  lines: ResumedLine[];
  /** A line lacks a complete snapshot or a sellable unit: payment is blocked until the order is held again. */
  mustRehold: boolean;
  /** Human-readable problems (deleted customer/warehouse/account/product …). Checkout stays blocked until fixed. */
  problems: string[];
  /** Information only (e.g. the current price differs from the held one that will be charged), each about one held line. */
  notices: { lineId: string; text: string }[];
};
