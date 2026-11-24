import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { currentScope, inScope, warehouseFilter, warehouseIdFilter } from "@/lib/access-scope";
import { formatQuantity } from "@/lib/money";
import { isRealIsoDate, type FilterOption } from "@/lib/inventory-report-core";

export type { FilterOption };

// Inventory Reports — READ-ONLY data access. Nothing here writes. Quantities stay Prisma.Decimal until the
// final string (no floating point). The app keeps no separate stock-movement table, so the Stock Card is
// derived from the immutable source documents that move stock (see getProductMovement).

type Dec = Prisma.Decimal;
const D = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v);
const ZERO = D(0);

// ---------------------------------------------------------------------------------------------
// Query parameters (validated here AND by every report route; the client form is only a convenience)
// ---------------------------------------------------------------------------------------------

export type ReportQueryError = "errWarehouse" | "errProduct" | "errDate" | "errDateOrder" | "errBadParams";
type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim().slice(0, 64) : "");

export type BalanceParams = { warehouseId: string; categoryId: string; brandId: string; includeZero: boolean };
export function parseBalanceParams(sp: Raw): { ok: true; p: BalanceParams } | { ok: false; error: ReportQueryError } {
  const warehouseId = one(sp.warehouse);
  if (!warehouseId) return { ok: false, error: "errWarehouse" };
  return { ok: true, p: { warehouseId, categoryId: one(sp.category), brandId: one(sp.brand), includeZero: one(sp.zero) === "1" } };
}

export type MovementParams = { productId: string; warehouseId: string; from: string; to: string };
export function parseMovementParams(sp: Raw): { ok: true; p: MovementParams } | { ok: false; error: ReportQueryError } {
  const productId = one(sp.product);
  if (!productId) return { ok: false, error: "errProduct" };
  const from = one(sp.from);
  const to = one(sp.to);
  if ((from && !isRealIsoDate(from)) || (to && !isRealIsoDate(to))) return { ok: false, error: "errDate" };
  if (from && to && from > to) return { ok: false, error: "errDateOrder" };
  return { ok: true, p: { productId, warehouseId: one(sp.warehouse), from, to } };
}

export type LowParams = { warehouseId: string; categoryId: string; brandId: string };
export function parseLowParams(sp: Raw): { ok: true; p: LowParams } {
  return { ok: true, p: { warehouseId: one(sp.warehouse), categoryId: one(sp.category), brandId: one(sp.brand) } };
}

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

export type StockStatus = "IN" | "LOW" | "OUT";
/** Out of stock = nothing on hand. Low = a usable alert (> 0) and stock at or below it. A product with alert 0 is never "low". */
export function stockStatus(qty: Dec, alert: Dec): StockStatus {
  if (qty.lte(0)) return "OUT";
  if (alert.gt(0) && qty.lte(alert)) return "LOW";
  return "IN";
}

/** "1,234.5" / "-3" — a signed quantity, no trailing zeros. */
export function fmtQty(v: Dec | string): string {
  const d = D(v);
  const s = formatQuantity(d.abs().toFixed(3));
  return d.isNegative() && !d.isZero() ? `-${s}` : s;
}

/** Sums per unit name (different units are never added together). */
function addTo(map: Map<string, Dec>, unit: string, v: Dec) {
  map.set(unit, (map.get(unit) ?? ZERO).plus(v));
}
export const totalsList = (m: Map<string, Dec>) => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([unit, v]) => ({ unit, value: fmtQty(v) }));

export async function getFilterOptions(): Promise<{ warehouses: FilterOption[]; categories: FilterOption[]; brands: FilterOption[]; products: FilterOption[] }> {
  const [w, c, b, p] = await Promise.all([
    db.warehouse.findMany({ where: await warehouseFilter(), orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.productCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.product.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);
  return {
    warehouses: w.map((x) => ({ value: x.id, label: x.name })),
    categories: c.map((x) => ({ value: x.id, label: x.name })),
    brands: b.map((x) => ({ value: x.id, label: x.name })),
    products: p.map((x) => ({ value: x.id, label: `${x.code} — ${x.name}` })),
  };
}

// ---------------------------------------------------------------------------------------------
// 1. Stock Balance by Warehouse
// ---------------------------------------------------------------------------------------------

export type BalanceRow = { code: string; name: string; category: string; brand: string; unit: string; inStock: string; alert: string; status: StockStatus };
export type BalanceReport = {
  warehouse: { id: string; name: string };
  category: string | null;
  brand: string | null;
  rows: BalanceRow[];
  totals: { products: number; lowStock: number; outOfStock: number; quantity: { unit: string; value: string }[] };
};

export async function getStockBalance(p: BalanceParams): Promise<BalanceReport | null> {
  const [warehouse, category, brand] = await Promise.all([
    db.warehouse.findUnique({ where: { id: p.warehouseId }, select: { id: true, name: true } }),
    p.categoryId ? db.productCategory.findUnique({ where: { id: p.categoryId }, select: { name: true } }) : null,
    p.brandId ? db.brand.findUnique({ where: { id: p.brandId }, select: { name: true } }) : null,
  ]);
  if (!warehouse || !(await inScope([warehouse.id])) || (p.categoryId && !category) || (p.brandId && !brand)) return null;

  // Only persisted stock rows of THIS warehouse (never product-level totals, never invented rows).
  const stocks = await db.productStock.findMany({
    where: {
      warehouseId: warehouse.id,
      ...(p.includeZero ? {} : { quantity: { gt: 0 } }),
      product: { ...(p.categoryId ? { categoryId: p.categoryId } : {}), ...(p.brandId ? { brandId: p.brandId } : {}) },
    },
    select: { quantity: true, product: { select: { code: true, name: true, stockAlert: true, category: { select: { name: true } }, brand: { select: { name: true } }, productUnit: { select: { name: true } } } } },
  });
  stocks.sort((a, b) => a.product.code.localeCompare(b.product.code));

  const qty = new Map<string, Dec>();
  let low = 0;
  let out = 0;
  const rows = stocks.map((s) => {
    const status = stockStatus(s.quantity, s.product.stockAlert);
    if (status === "LOW") low++;
    if (status === "OUT") out++;
    addTo(qty, s.product.productUnit.name, s.quantity);
    return { code: s.product.code, name: s.product.name, category: s.product.category.name, brand: s.product.brand.name, unit: s.product.productUnit.name, inStock: fmtQty(s.quantity), alert: fmtQty(s.product.stockAlert), status };
  });
  return { warehouse, category: category?.name ?? null, brand: brand?.name ?? null, rows, totals: { products: rows.length, lowStock: low, outOfStock: out, quantity: totalsList(qty) } };
}

// ---------------------------------------------------------------------------------------------
// 3. Low Stock Items
// ---------------------------------------------------------------------------------------------

export type LowRow = { code: string; name: string; category: string; brand: string; unit: string; warehouse: string; inStock: string; alert: string; shortage: string; status: "LOW" | "OUT" };
export type LowReport = {
  warehouse: string | null;
  category: string | null;
  brand: string | null;
  rows: LowRow[];
  totals: { items: number; out: number; shortage: { unit: string; value: string }[] };
};

export async function getLowStock(p: LowParams): Promise<LowReport | null> {
  const [warehouse, category, brand] = await Promise.all([
    p.warehouseId ? db.warehouse.findUnique({ where: { id: p.warehouseId }, select: { name: true } }) : null,
    p.categoryId ? db.productCategory.findUnique({ where: { id: p.categoryId }, select: { name: true } }) : null,
    p.brandId ? db.brand.findUnique({ where: { id: p.brandId }, select: { name: true } }) : null,
  ]);
  if ((p.warehouseId && (!warehouse || !(await inScope([p.warehouseId])))) || (p.categoryId && !category) || (p.brandId && !brand)) return null;

  // Each persisted product/warehouse location is judged on its own stock; only a usable alert (> 0) counts.
  const stocks = await db.productStock.findMany({
    where: {
      AND: [await warehouseIdFilter()], // a scoped user only ever sees their own warehouses
      ...(p.warehouseId ? { warehouseId: p.warehouseId } : {}),
      product: { stockAlert: { gt: 0 }, ...(p.categoryId ? { categoryId: p.categoryId } : {}), ...(p.brandId ? { brandId: p.brandId } : {}) },
    },
    select: { quantity: true, warehouse: { select: { name: true } }, product: { select: { code: true, name: true, stockAlert: true, category: { select: { name: true } }, brand: { select: { name: true } }, productUnit: { select: { name: true } } } } },
  });
  const hits = stocks.filter((s) => s.quantity.lte(s.product.stockAlert));
  hits.sort((a, b) => a.warehouse.name.localeCompare(b.warehouse.name) || Number(b.quantity.lte(0)) - Number(a.quantity.lte(0)) || a.product.code.localeCompare(b.product.code));

  const shortage = new Map<string, Dec>();
  let out = 0;
  const rows = hits.map((s) => {
    const short = Prisma.Decimal.max(ZERO, s.product.stockAlert.minus(s.quantity));
    const status = s.quantity.lte(0) ? ("OUT" as const) : ("LOW" as const);
    if (status === "OUT") out++;
    addTo(shortage, s.product.productUnit.name, short);
    return { code: s.product.code, name: s.product.name, category: s.product.category.name, brand: s.product.brand.name, unit: s.product.productUnit.name, warehouse: s.warehouse.name, inStock: fmtQty(s.quantity), alert: fmtQty(s.product.stockAlert), shortage: fmtQty(short), status };
  });
  return { warehouse: warehouse?.name ?? null, category: category?.name ?? null, brand: brand?.name ?? null, rows, totals: { items: rows.length, out, shortage: totalsList(shortage) } };
}

// ---------------------------------------------------------------------------------------------
// 2. Product Movement / Stock Card
// ---------------------------------------------------------------------------------------------

export type MovementKind = "INITIAL_STOCK" | "OPENING_STOCK" | "PURCHASE" | "PURCHASE_RETURN" | "SALE" | "POS_SALE" | "SALE_RETURN" | "TRANSFER_OUT" | "TRANSFER_IN" | "ADJ_ADD" | "ADJ_SUB";

/** One stock movement of one product in one warehouse (signed: + in, − out). */
export type Movement = {
  /** Effective business day, YYYY-MM-DD. */
  day: string;
  /** Immutable record timestamp (ms) — same-day ordering. */
  at: number;
  ref: string;
  link: string | null;
  kind: MovementKind;
  warehouseId: string;
  qty: Dec;
  /** Transfers: the other warehouse's name. */
  counterpart: string | null;
  /** Free text the user wrote on the source document (data, never translated). */
  notes: string;
  /** Tie-break after (day, at, ref). */
  ord: number;
};

export type LedgerRow = Movement & { qtyIn: string; qtyOut: string; balance: string };
export type LedgerSection = {
  warehouse: { id: string; name: string };
  opening: string;
  rows: LedgerRow[];
  inTotal: string;
  outTotal: string;
  closing: string;
  current: string;
  /** current stock − full-history ledger total; null when they agree. */
  variance: string | null;
};

/** Deterministic order: business day, then the record timestamp, then reference, then the in-document order. */
export const compareMovements = (a: Movement, b: Movement) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.at - b.at || a.ref.localeCompare(b.ref) || a.ord - b.ord);

/**
 * Pure ledger maths for ONE product in ONE warehouse. Opening = everything before `from`; the period is
 * from..to inclusive; the running balance starts at the opening balance. `fullTotal` is the sum of ALL
 * movements (used to reconcile with the stored stock).
 */
export function buildLedger(all: Movement[], from: string, to: string): { opening: Dec; rows: (Movement & { balance: Dec })[]; inTotal: Dec; outTotal: Dec; closing: Dec; fullTotal: Dec } {
  const sorted = [...all].sort(compareMovements);
  let opening = ZERO;
  let fullTotal = ZERO;
  for (const m of sorted) {
    fullTotal = fullTotal.plus(m.qty);
    if (from && m.day < from) opening = opening.plus(m.qty);
  }
  let run = opening;
  let inTotal = ZERO;
  let outTotal = ZERO;
  const rows: (Movement & { balance: Dec })[] = [];
  for (const m of sorted) {
    if (from && m.day < from) continue;
    if (to && m.day > to) continue;
    run = run.plus(m.qty);
    if (m.qty.gt(0)) inTotal = inTotal.plus(m.qty);
    else outTotal = outTotal.plus(m.qty.abs());
    rows.push({ ...m, balance: run });
  }
  return { opening, rows, inTotal, outTotal, closing: run, fullTotal };
}

export const dayOfDateOnly = (d: Date) => d.toISOString().slice(0, 10); // MySQL DATE → UTC midnight
const pad = (n: number) => String(n).padStart(2, "0");
export const dayOfTimestamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // server-local day, like todayLocal()

export type MovementReport = {
  product: { id: string; code: string; name: string; unit: string };
  warehouse: string | null;
  sections: LedgerSection[];
};

/**
 * Every stock movement of ONE product (optionally one warehouse), derived from the saved documents that move
 * stock. Shared by the Stock Card report and by the chronological-history guard (lib/stock-history-guard.ts),
 * so both always agree on what the history is. `client` is the database or a transaction.
 */
export async function loadMovements(client: Prisma.TransactionClient, productId: string, warehouseId: string | null): Promise<Movement[]> {
  const wf = warehouseId ? { warehouseId } : {};

  const [entries, purchaseItems, purchaseReturnItems, saleItems, saleReturnItems, transferItems, adjustmentItems, warehouses] = await Promise.all([
    client.productStockEntry.findMany({ where: { productId, status: "RECEIVED", ...wf }, select: { id: true, warehouseId: true, quantity: true, source: true, createdAt: true } }),
    client.purchaseItem.findMany({
      where: { productId, purchase: { status: "RECEIVED", ...wf } },
      select: { baseQuantity: true, purchase: { select: { id: true, reference: true, warehouseId: true, receivedAt: true, createdAt: true, purchaseDate: true, notes: true } } },
    }),
    client.purchaseReturnItem.findMany({
      where: { productId, purchaseReturn: { ...wf } },
      select: { baseQuantity: true, purchaseReturn: { select: { id: true, reference: true, warehouseId: true, returnDate: true, createdAt: true, notes: true } } },
    }),
    client.saleItem.findMany({
      where: { productId, sale: { status: "COMPLETED", ...wf } },
      select: { baseQuantity: true, sale: { select: { id: true, reference: true, warehouseId: true, completedAt: true, saleDate: true, createdAt: true, posCheckoutKey: true, notes: true } } },
    }),
    client.saleReturnItem.findMany({
      where: { productId, saleReturn: { ...wf } },
      select: { baseQuantity: true, saleReturn: { select: { id: true, reference: true, warehouseId: true, returnDate: true, createdAt: true, notes: true } } },
    }),
    client.stockTransferItem.findMany({
      where: { productId, transfer: { status: { in: ["SENT", "COMPLETED"] }, ...(warehouseId ? { OR: [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }] } : {}) } },
      select: { baseQuantity: true, transfer: { select: { id: true, reference: true, status: true, fromWarehouseId: true, toWarehouseId: true, transferDate: true, createdAt: true, note: true } } },
    }),
    client.stockAdjustmentItem.findMany({
      where: { productId, adjustment: { ...wf } },
      select: { baseQuantity: true, type: true, adjustment: { select: { id: true, reference: true, warehouseId: true, adjustmentDate: true, createdAt: true } } },
    }),
    client.warehouse.findMany({ select: { id: true, name: true } }),
  ]);
  const wname = new Map(warehouses.map((w) => [w.id, w.name]));

  const ev: Movement[] = [];
  const push = (m: Omit<Movement, "notes" | "counterpart" | "ord"> & Partial<Pick<Movement, "notes" | "counterpart" | "ord">>) => ev.push({ notes: "", counterpart: null, ord: 0, ...m });

  for (const e of entries) {
    // Opening stock entries (Create Product form) and initial stock (CSV import): RECEIVED ones are on hand.
    push({ day: dayOfTimestamp(e.createdAt), at: e.createdAt.getTime(), ref: "", link: `/products/${productId}/edit`, kind: e.source === "INITIAL_STOCK" ? "INITIAL_STOCK" : "OPENING_STOCK", warehouseId: e.warehouseId, qty: e.quantity });
  }
  for (const i of purchaseItems) {
    const pu = i.purchase;
    const when = pu.receivedAt ?? pu.createdAt; // the moment the stock actually arrived
    push({ day: dayOfTimestamp(when), at: when.getTime(), ref: pu.reference, link: `/purchases/${pu.id}`, kind: "PURCHASE", warehouseId: pu.warehouseId, qty: i.baseQuantity, notes: pu.notes ?? "" });
  }
  for (const i of purchaseReturnItems) {
    const r = i.purchaseReturn;
    push({ day: dayOfDateOnly(r.returnDate), at: r.createdAt.getTime(), ref: r.reference, link: `/purchases/returns/${r.id}`, kind: "PURCHASE_RETURN", warehouseId: r.warehouseId, qty: i.baseQuantity.negated(), notes: r.notes ?? "" });
  }
  for (const i of saleItems) {
    const s = i.sale;
    // Completion moment when stored; otherwise the sale's own business date.
    const day = s.completedAt ? dayOfTimestamp(s.completedAt) : dayOfDateOnly(s.saleDate);
    push({ day, at: (s.completedAt ?? s.createdAt).getTime(), ref: s.reference, link: `/sales/${s.id}`, kind: s.posCheckoutKey ? "POS_SALE" : "SALE", warehouseId: s.warehouseId, qty: i.baseQuantity.negated(), notes: s.notes ?? "" });
  }
  for (const i of saleReturnItems) {
    const r = i.saleReturn;
    push({ day: dayOfDateOnly(r.returnDate), at: r.createdAt.getTime(), ref: r.reference, link: `/sales/returns/${r.id}`, kind: "SALE_RETURN", warehouseId: r.warehouseId, qty: i.baseQuantity, notes: r.notes ?? "" });
  }
  for (const i of transferItems) {
    const t = i.transfer;
    const base = { day: dayOfDateOnly(t.transferDate), at: t.createdAt.getTime(), ref: t.reference, link: `/transfers/${t.id}`, notes: t.note ?? "" };
    // SENT and COMPLETED took the stock out of the source; only COMPLETED put it into the destination.
    if (!warehouseId || t.fromWarehouseId === warehouseId) push({ ...base, kind: "TRANSFER_OUT", warehouseId: t.fromWarehouseId, qty: i.baseQuantity.negated(), counterpart: wname.get(t.toWarehouseId) ?? null, ord: 0 });
    if (t.status === "COMPLETED" && (!warehouseId || t.toWarehouseId === warehouseId)) push({ ...base, kind: "TRANSFER_IN", warehouseId: t.toWarehouseId, qty: i.baseQuantity, counterpart: wname.get(t.fromWarehouseId) ?? null, ord: 1 });
  }
  for (const i of adjustmentItems) {
    const a = i.adjustment;
    push({ day: dayOfDateOnly(a.adjustmentDate), at: a.createdAt.getTime(), ref: a.reference, link: `/adjustments/${a.id}/edit`, kind: i.type === "ADDITION" ? "ADJ_ADD" : "ADJ_SUB", warehouseId: a.warehouseId, qty: i.type === "ADDITION" ? i.baseQuantity : i.baseQuantity.negated() });
  }

  return ev;
}

export async function getProductMovement(p: MovementParams): Promise<MovementReport | null> {
  const [product, filterWh] = await Promise.all([
    db.product.findUnique({ where: { id: p.productId }, select: { id: true, code: true, name: true, productUnit: { select: { name: true } } } }),
    p.warehouseId ? db.warehouse.findUnique({ where: { id: p.warehouseId }, select: { id: true, name: true } }) : null,
  ]);
  if (!product || (p.warehouseId && (!filterWh || !(await inScope([p.warehouseId]))))) return null;
  const productId = product.id;
  const scope = await currentScope();
  const allEv = await loadMovements(db, productId, p.warehouseId || null);
  const ev = scope === null ? allEv : allEv.filter((m) => scope.includes(m.warehouseId)); // other warehouses' movements are never shown
  const [stocks, warehouses] = await Promise.all([
    db.productStock.findMany({ where: { productId, AND: [await warehouseIdFilter()], ...(p.warehouseId ? { warehouseId: p.warehouseId } : {}) }, select: { warehouseId: true, quantity: true } }),
    db.warehouse.findMany({ select: { id: true, name: true } }),
  ]);
  const wname = new Map(warehouses.map((w) => [w.id, w.name]));

  // One ledger per warehouse — warehouses are never combined.
  const byWh = new Map<string, Movement[]>();
  for (const m of ev) byWh.set(m.warehouseId, [...(byWh.get(m.warehouseId) ?? []), m]);
  const stockOf = new Map(stocks.map((s) => [s.warehouseId, s.quantity]));
  const ids = new Set<string>([...byWh.keys(), ...stockOf.keys(), ...(filterWh ? [filterWh.id] : [])]);

  const sections: LedgerSection[] = [...ids]
    .filter((id) => wname.has(id))
    .sort((a, b) => (wname.get(a) ?? "").localeCompare(wname.get(b) ?? ""))
    .map((id) => {
      const L = buildLedger(byWh.get(id) ?? [], p.from, p.to);
      const current = stockOf.get(id) ?? ZERO;
      const diff = current.minus(L.fullTotal);
      return {
        warehouse: { id, name: wname.get(id)! },
        opening: fmtQty(L.opening),
        rows: L.rows.map((r) => ({ ...r, qtyIn: r.qty.gt(0) ? fmtQty(r.qty) : "", qtyOut: r.qty.lt(0) ? fmtQty(r.qty.abs()) : "", balance: fmtQty(r.balance) })),
        inTotal: fmtQty(L.inTotal),
        outTotal: fmtQty(L.outTotal),
        closing: fmtQty(L.closing),
        current: fmtQty(current),
        variance: diff.isZero() ? null : fmtQty(diff),
      };
    });

  return { product: { id: product.id, code: product.code, name: product.name, unit: product.productUnit.name }, warehouse: filterWh?.name ?? null, sections };
}
