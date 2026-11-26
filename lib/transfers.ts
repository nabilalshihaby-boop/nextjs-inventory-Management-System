import { z } from "zod";
import type { ProductUnits } from "@/lib/unit-math";
import { fmt } from "@/lib/i18n/config";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n";

// Shared Inventory Transfer rules (client + server). Quantities (3 dp) and money (2 dp) stay
// decimal strings; arithmetic uses scaled BigInt integers — never floating point.

export const TRANSFER_STATUSES = ["PENDING", "SENT", "COMPLETED"] as const;
export type TransferStatusValue = (typeof TRANSFER_STATUSES)[number];

/** Same order as design/Create Transfer.html (Completed, Sent, Pending). */
export const TRANSFER_STATUS_OPTIONS = [
  { value: "COMPLETED", label: "Completed" },
  { value: "SENT", label: "Sent" },
  { value: "PENDING", label: "Pending" },
] as const;

export const STATUS_LABEL: Record<TransferStatusValue, string> = { PENDING: "Pending", SENT: "Sent", COMPLETED: "Completed" };
/** Design Badge status → tone map (completed = success, sent = info, pending = warning). */
export const STATUS_TONE: Record<TransferStatusValue, string> = { PENDING: "warning", SENT: "info", COMPLETED: "success" };

export const MAX_TRANSFER_ITEMS = 200;

/** "TR_000001" — generated server-side from the sequential transfer number. */
export const formatReference = (n: number) => `TR_${String(n).padStart(6, "0")}`;

// ---- Decimal helpers (scaled BigInt) ----------------------------------------------------------

const QTY_RE = /^\d{1,11}(\.\d{1,3})?$/; // DECIMAL(14,3)

/** "12.5" at scale 3 → 12500 (bigint). The input must already be a plain non-negative decimal string. */
export function toUnits(value: string, scale: number): bigint {
  const [i, f = ""] = value.trim().split(".");
  return BigInt(i || "0") * BigInt(10) ** BigInt(scale) + BigInt((f + "0".repeat(scale)).slice(0, scale) || "0");
}

/** 12500 (bigint) at scale 3 → "12.500". */
export function fromUnits(units: bigint, scale: number): string {
  const neg = units < BigInt(0);
  const abs = neg ? -units : units;
  const base = BigInt(10) ** BigInt(scale);
  const int = (abs / base).toString();
  const frac = scale ? "." + (abs % base).toString().padStart(scale, "0") : "";
  return (neg ? "-" : "") + int + frac;
}

/** qty (3 dp) × unit cost (2 dp) rounded half-up to 2 dp, in cents. */
export function lineTotalCents(quantity: string, unitCost: string): bigint {
  const x = toUnits(quantity, 3) * toUnits(unitCost, 2); // scale 5
  return (x + BigInt(500)) / BigInt(1000);
}

/** Grand total (2 dp string) of a transfer's lines. */
export function transferTotal(items: { quantity: string; unitCost: string }[]): string {
  return fromUnits(items.reduce((a, i) => a + lineTotalCents(i.quantity, i.unitCost), BigInt(0)), 2);
}

export const isQuantity = (v: string) => QTY_RE.test(v.trim()) && toUnits(v, 3) > BigInt(0);

// ---- Validation ---------------------------------------------------------------------------------

const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);

function isValidDate(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2199;
}

/**
 * Create/update payload. Only ids, quantities, date, status and note are accepted — any cost,
 * stock or reference values a client sends are stripped and never used. Messages are dictionary
 * text (English by default).
 */
export function makeTransferSchema(m: Dictionary["transfers"]["val"] = en.transfers.val) {
  const itemSchema = z.object({
    productId: id(m.chooseProduct),
    /** The selected product unit (selector only; blank = the base unit). The server resolves factor and base quantity. */
    unitId: z.string().trim().max(64).optional().default(""),
    quantity: z
      .string({ error: m.qtyRequired })
      .trim()
      .refine((v) => QTY_RE.test(v), m.qtyDecimals)
      .refine((v) => !QTY_RE.test(v) || toUnits(v, 3) > BigInt(0), m.qtyPositive),
  });
  return z
    .object({
      transferDate: z.string({ error: m.dateRequired }).trim().min(1, m.dateRequired).refine(isValidDate, m.dateInvalid),
      fromWarehouseId: id(m.fromRequired),
      toWarehouseId: id(m.toRequired),
      status: z.enum(TRANSFER_STATUSES, { error: m.statusInvalid }),
      note: z.string().trim().max(2000, m.noteLong).optional().default(""),
      items: z
        .array(itemSchema, { error: m.addProduct })
        .min(1, m.addProduct)
        .max(MAX_TRANSFER_ITEMS, fmt(m.maxItems, { max: MAX_TRANSFER_ITEMS })),
    })
    .superRefine((v, ctx) => {
      if (v.fromWarehouseId === v.toWarehouseId) {
        ctx.addIssue({ code: "custom", path: ["toWarehouseId"], message: m.sameWarehouse });
      }
      const seen = new Set<string>();
      for (const i of v.items) {
        if (seen.has(i.productId)) {
          ctx.addIssue({ code: "custom", path: ["items"], message: m.dupProduct });
          break;
        }
        seen.add(i.productId);
      }
    });
}
export const transferInputSchema = makeTransferSchema();

export type TransferInput = z.infer<typeof transferInputSchema>;
export type TransferField = "transferDate" | "fromWarehouseId" | "toWarehouseId" | "status" | "note" | "items";

// ---- View-model types ---------------------------------------------------------------------------

export type WarehouseOption = { value: string; label: string };

/** A product with positive on-hand stock in one warehouse (picker source). */
export type StockOption = {
  warehouseId: string;
  productId: string;
  code: string;
  name: string;
  unit: string;
  /** Product.cost (2 dp) — the read-only unit-cost snapshot. */
  cost: string;
  /** On-hand quantity in that warehouse (3 dp) — always in BASE units. */
  available: string;
  /** The product's units (display only; the server resolves factor and base quantity). */
  unitInfo: ProductUnits;
  /** Stored barcodes (search only). */
  barcodes?: string[];
  /** Deactivated: listed only so an existing transfer line stays visible; never suggested. */
  inactive?: boolean;
};

export type TransferFormValues = {
  transferDate: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  status: TransferStatusValue;
  note: string;
  items: { productId: string; quantity: string; unitId?: string }[];
};

export type TransferRow = {
  id: string;
  reference: string;
  from: string;
  to: string;
  items: number;
  /** Formatted grand total, or null when costs are hidden (USER). */
  total: string | null;
  status: TransferStatusValue;
  createdOn: string;
};
