import type { Prisma } from "@/app/generated/prisma/client";
import { toBaseQuantity, trimFactor } from "@/lib/unit-math";

// Product unit conversions — SERVER-ONLY resolution and safety rules. The Unit master is only a label; every
// product has exactly one base unit (factor 1) and any number of other units with a product-specific factor.
// Stock is stored and protected in BASE units; each document line keeps an immutable snapshot of the unit,
// the factor used and the base quantity. Nothing the browser sends (factor, base quantity, purpose) is trusted:
// the unit id is only a selector, resolved here against the product's own active conversions.

type Client = Prisma.TransactionClient;

/** Every STORED barcode of each product's units (active or not), base unit first: lookup data for product selectors (search only). */
export async function barcodesOf(client: Client, productIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!productIds.length) return out;
  const rows = await client.productUnitConversion.findMany({ where: { productId: { in: productIds }, barcode: { not: null } }, orderBy: [{ isBase: "desc" }, { createdAt: "asc" }], select: { productId: true, barcode: true } });
  for (const r of rows) if (r.barcode) out.set(r.productId, [...(out.get(r.productId) ?? []), r.barcode]);
  return out;
}

export type UnitView = { unitId: string; name: string; factor: string; isBase: boolean; active: boolean; forSales: boolean; forPurchases: boolean; barcode?: string | null };
export type UnitSet = { productId: string; baseUnitId: string; saleUnitId: string; purchaseUnitId: string; units: UnitView[] };
export type Purpose = "SALE" | "PURCHASE" | "ANY";

export type ResolvedUnit = { unitId: string; unitName: string; factor: string; baseQuantity: string };
export type UnitFailure = { key: "units.err.notAllowed" | "units.err.baseDecimals" | "units.err.baseRange"; vars: Record<string, string> };

/** Unit sets for the given products. A product with NO conversion rows (older data) is treated as base-unit only, factor 1. */
export async function loadUnitSets(client: Client, productIds: string[]): Promise<Map<string, UnitSet>> {
  const ids = [...new Set(productIds)];
  if (!ids.length) return new Map();
  const products = await client.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      productUnitId: true,
      saleUnitId: true,
      purchaseUnitId: true,
      productUnit: { select: { name: true } },
      unitConversions: { select: { unitId: true, factor: true, isBase: true, active: true, forSales: true, forPurchases: true, barcode: true, unit: { select: { name: true } } } },
    },
  });
  const out = new Map<string, UnitSet>();
  for (const p of products) {
    let units: UnitView[] = p.unitConversions.map((c) => ({ unitId: c.unitId, name: c.unit.name, factor: trimFactor(c.factor.toFixed(6)), isBase: c.isBase, active: c.active, forSales: c.forSales, forPurchases: c.forPurchases, barcode: c.barcode }));
    if (!units.some((u) => u.unitId === p.productUnitId)) units = [{ unitId: p.productUnitId, name: p.productUnit.name, factor: "1", isBase: true, active: true, forSales: true, forPurchases: true }, ...units];
    out.set(p.id, { productId: p.id, baseUnitId: p.productUnitId, saleUnitId: p.saleUnitId, purchaseUnitId: p.purchaseUnitId, units });
  }
  return out;
}

const allowed = (u: UnitView, purpose: Purpose) => u.active && (purpose === "ANY" || (purpose === "SALE" ? u.forSales : u.forPurchases));

/** The unit a line uses: the requested one when it is an active, permitted conversion of THIS product; blank → the product default. */
export function pickUnit(set: UnitSet, requested: string | undefined | null, purpose: Purpose): UnitView | null {
  const want = (requested ?? "").trim();
  if (want) {
    const u = set.units.find((x) => x.unitId === want);
    return u && allowed(u, purpose) ? u : null;
  }
  const def = purpose === "SALE" ? set.saleUnitId : purpose === "PURCHASE" ? set.purchaseUnitId : set.baseUnitId;
  const d = set.units.find((x) => x.unitId === def);
  if (d && allowed(d, purpose)) return d;
  return set.units.find((x) => x.isBase) ?? null; // the base unit is always usable
}

/** Resolve one line: the unit, its factor and the exact base quantity — or a dictionary key explaining why not. */
export function resolveLine(set: UnitSet | undefined, requested: string | undefined | null, purpose: Purpose, entered: string, label: string): { ok: true; r: ResolvedUnit } | { ok: false; f: UnitFailure } {
  const bad = (key: UnitFailure["key"], extra: Record<string, string> = {}): { ok: false; f: UnitFailure } => ({ ok: false, f: { key, vars: { product: label, ...extra } } });
  if (!set) return bad("units.err.notAllowed", { unit: "" });
  const u = pickUnit(set, requested, purpose);
  if (!u) return bad("units.err.notAllowed", { unit: set.units.find((x) => x.unitId === (requested ?? "").trim())?.name ?? "" });
  const b = toBaseQuantity(entered, u.factor);
  if (!b.ok) return b.reason === "decimals" ? bad("units.err.baseDecimals", { unit: u.name, qty: entered, factor: u.factor }) : bad("units.err.baseRange", { unit: u.name });
  return { ok: true, r: { unitId: u.unitId, unitName: u.name, factor: u.factor, baseQuantity: b.value } };
}

type Num = { toFixed(d: number): string };
type Dec = import("@/app/generated/prisma/client").Prisma.Decimal;

/**
 * Whether a held POS order line carries a COMPLETE, VALID financial snapshot (the database enforces the same). A line without one can't be
 * paid until the order is held again, and gives nothing to that new hold.
 */
export const hasSnapshot = (row: { unitId: string | null; unitName: string | null; unitFactor: Dec | null; baseQuantity: Dec | null; quantity: Dec; unitPrice: Dec; taxType: string | null; taxRate: Dec | null }) =>
  !!row.unitId &&
  !!row.unitName?.trim() &&
  !!row.unitFactor?.gt(0) &&
  !!row.baseQuantity?.gt(0) &&
  row.quantity.times(row.unitFactor).equals(row.baseQuantity) &&
  row.unitPrice.gte(0) &&
  (row.taxType === "EXCLUSIVE" || row.taxType === "INCLUSIVE") &&
  !!row.taxRate?.gte(0) &&
  row.taxRate.lte(100);

/**
 * A held POS order line's stored unit snapshot applied to a quantity: the HELD factor (never the product's current one) decides the base
 * quantity. Null when the line has no snapshot (held before snapshots existed).
 */
export function heldUnit(row: { unitId: string | null; unitName: string | null; unitFactor: Num | null }, entered: string, label: string): { ok: true; r: ResolvedUnit } | { ok: false; f: UnitFailure } | null {
  if (!row.unitId || !row.unitName || !row.unitFactor) return null;
  const factor = trimFactor(row.unitFactor.toFixed(6));
  const b = toBaseQuantity(entered, factor);
  if (!b.ok) return { ok: false, f: b.reason === "decimals" ? { key: "units.err.baseDecimals", vars: { product: label, unit: row.unitName, qty: entered, factor } } : { key: "units.err.baseRange", vars: { product: label, unit: row.unitName } } };
  return { ok: true, r: { unitId: row.unitId, unitName: row.unitName, factor, baseQuantity: b.value } };
}

/** The immutable snapshot columns of a document line. */
export const lineSnapshot = (r: ResolvedUnit) => ({ unitId: r.unitId, unitName: r.unitName, unitFactor: r.factor, baseQuantity: r.baseQuantity });

// ---------------------------------------------------------------------------------------------
// Change safety
// ---------------------------------------------------------------------------------------------

/** True when ANY business record refers to the product: stock, stock history or a line of any document. */
export async function productHasActivity(client: Client, productId: string): Promise<boolean> {
  const where = { productId };
  const counts = await Promise.all([
    client.productStock.count({ where }),
    client.productStockEntry.count({ where }),
    client.purchaseItem.count({ where }),
    client.purchaseReturnItem.count({ where }),
    client.saleItem.count({ where }),
    client.saleReturnItem.count({ where }),
    client.quotationItem.count({ where }),
    client.stockTransferItem.count({ where }),
    client.stockAdjustmentItem.count({ where }),
    client.posHeldOrderItem.count({ where }),
  ]);
  return counts.some((n) => n > 0);
}

/**
 * True when a (non-base) conversion has been USED: a line carries its unit id, or it is a factor-1 mapping on a
 * product that has older lines without a unit snapshot (those were always factor 1 — they must not be reinterpreted).
 * Used conversions keep their factor; they may only be deactivated.
 */
export async function conversionUsed(client: Client, productId: string, unitId: string, factor: string): Promise<boolean> {
  const w = { productId, unitId };
  const byId = await Promise.all([
    client.purchaseItem.count({ where: w }),
    client.purchaseReturnItem.count({ where: w }),
    client.saleItem.count({ where: w }),
    client.saleReturnItem.count({ where: w }),
    client.stockTransferItem.count({ where: w }),
    client.stockAdjustmentItem.count({ where: w }),
    client.posHeldOrderItem.count({ where: w }),
  ]);
  if (byId.some((n) => n > 0)) return true;
  if (factor !== "1") return false;
  const legacy = { productId, unitId: null };
  const old = await Promise.all([
    client.purchaseItem.count({ where: legacy }),
    client.purchaseReturnItem.count({ where: legacy }),
    client.saleItem.count({ where: legacy }),
    client.saleReturnItem.count({ where: legacy }),
    client.stockTransferItem.count({ where: legacy }),
    client.stockAdjustmentItem.count({ where: legacy }),
  ]);
  return old.some((n) => n > 0);
}

/** Active units per product for the document forms (display data only). */
export async function unitOptionsFor(client: Client, productIds: string[], withBarcodes = false): Promise<Map<string, import("@/lib/unit-math").ProductUnits>> {
  const sets = await loadUnitSets(client, productIds);
  const base = await client.productUnit.findMany({ where: { id: { in: [...new Set([...sets.values()].map((s) => s.baseUnitId))] } }, select: { id: true, name: true } });
  const baseName = new Map(base.map((b) => [b.id, b.name]));
  const out = new Map<string, import("@/lib/unit-math").ProductUnits>();
  for (const [id, s] of sets) {
    out.set(id, {
      baseUnit: baseName.get(s.baseUnitId) ?? s.units.find((u) => u.isBase)?.name ?? "",
      baseUnitId: s.baseUnitId,
      saleUnitId: s.saleUnitId,
      purchaseUnitId: s.purchaseUnitId,
      units: s.units.filter((u) => u.active).map((u) => ({ unitId: u.unitId, name: u.name, factor: u.factor, forSales: u.forSales, forPurchases: u.forPurchases, ...(withBarcodes ? { barcode: u.barcode ?? null } : {}) })),
    });
  }
  return out;
}
