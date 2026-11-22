// Exact unit arithmetic (client + server, no floating point anywhere). A conversion factor is the number of BASE
// units in ONE of a product's unit: DECIMAL(16,6), strictly positive. Quantities are DECIMAL(14,3).

const FACTOR_RE = /^\d{1,10}(\.\d{1,6})?$/;
const QTY_RE = /^\d{1,11}(\.\d{1,3})?$/;
const SCALE6 = BigInt(1_000_000);
/** Largest base quantity a line/stock row can hold (DECIMAL(14,3)). */
const MAX_BASE_SCALED = BigInt("99999999999999"); // 99,999,999,999.999 × 1000

function scaled(v: string, scale: number): bigint {
  const [i, f = ""] = v.split(".");
  return BigInt(i + (f + "0".repeat(scale)).slice(0, scale));
}
function show(v: bigint, scale: number): string {
  const neg = v < BigInt(0);
  const s = (neg ? -v : v).toString().padStart(scale + 1, "0");
  const whole = s.slice(0, s.length - scale);
  const frac = s.slice(s.length - scale);
  return `${neg ? "-" : ""}${whole}${scale ? "." + frac : ""}`;
}

/** A factor string is valid when it is a plain decimal with at most 6 decimals, > 0 and below 10,000,000,000. */
export function isValidFactor(v: string): boolean {
  const t = v.trim();
  return FACTOR_RE.test(t) && scaled(t, 6) > BigInt(0);
}
/** "12" / "0.5" / "0.001" — trailing zeros removed for display. */
export function trimFactor(v: string): string {
  const t = v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v;
  return t === "" ? "0" : t;
}

export type BaseQty = { ok: true; value: string } | { ok: false; reason: "decimals" | "range" | "invalid" };

/**
 * Entered quantity (≤ 3 decimals) × factor (≤ 6 decimals) → base quantity with EXACTLY 3 decimals. It is refused
 * (never rounded) when the product would need more than 3 decimals of base unit, or does not fit the column.
 */
export function toBaseQuantity(entered: string, factor: string): BaseQty {
  const q = entered.trim();
  const f = factor.trim();
  if (!QTY_RE.test(q) || !isValidFactor(f)) return { ok: false, reason: "invalid" };
  const product = scaled(q, 3) * scaled(f, 6); // scale 9
  if (product % SCALE6 !== BigInt(0)) return { ok: false, reason: "decimals" };
  const base = product / SCALE6; // scale 3
  if (base > MAX_BASE_SCALED) return { ok: false, reason: "range" };
  return { ok: true, value: show(base, 3) };
}

/** The product's base price × factor, rounded half-up to cents — only a DEFAULT suggestion for a unit price. */
export function scalePrice(basePrice: string, factor: string): string {
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(basePrice.trim()) || !isValidFactor(factor)) return basePrice;
  const cents = scaled(basePrice.trim(), 2) * scaled(factor.trim(), 6); // scale 8
  const d = BigInt(1_000_000);
  return show((cents * BigInt(2) + d) / (d * BigInt(2)), 2);
}

/** Stock check helper for forms: base quantity as scaled-by-1000 bigint (0 when the input is not valid). */
export function baseUnits(entered: string, factor: string): bigint {
  const r = toBaseQuantity(entered, factor);
  return r.ok ? scaled(r.value, 3) : BigInt(0);
}

// ---------------------------------------------------------------------------------------------
// What a document form needs to know about a product's units (display data; the server re-resolves everything).
// ---------------------------------------------------------------------------------------------
export type LineUnit = { unitId: string; name: string; factor: string; forSales: boolean; forPurchases: boolean; /** Only sent to the POS (scanner lookup); display data, never trusted by the server. */ barcode?: string | null };
export type ProductUnits = { baseUnit: string; baseUnitId: string; saleUnitId: string; purchaseUnitId: string; units: LineUnit[] };
export type UnitPurpose = "SALE" | "PURCHASE" | "ANY";

/** The active units a line may use for a purpose (the base unit is always included). */
export function allowedUnits(pu: ProductUnits, purpose: UnitPurpose): LineUnit[] {
  return pu.units.filter((u) => u.unitId === pu.baseUnitId || purpose === "ANY" || (purpose === "SALE" ? u.forSales : u.forPurchases));
}
/** The unit a new line starts with: the product's default for the purpose, else the base unit. */
export function defaultLineUnit(pu: ProductUnits, purpose: UnitPurpose): LineUnit {
  const list = allowedUnits(pu, purpose);
  const want = purpose === "SALE" ? pu.saleUnitId : purpose === "PURCHASE" ? pu.purchaseUnitId : pu.baseUnitId;
  return list.find((u) => u.unitId === want) ?? list.find((u) => u.unitId === pu.baseUnitId) ?? list[0];
}
export const findLineUnit = (pu: ProductUnits, unitId: string): LineUnit => pu.units.find((u) => u.unitId === unitId) ?? pu.units.find((u) => u.unitId === pu.baseUnitId) ?? pu.units[0];

/** Largest WHOLE number of a unit that fits in `stock` base units (exact; the POS steps in whole units). */
export function maxWholeUnits(stock: string, factor: string): number {
  if (!/^\d{1,11}(\.\d{1,3})?$/.test(stock) || !isValidFactor(factor)) return 0;
  const n = (scaled(stock, 3) * BigInt(1000)) / scaled(factor, 6); // (S/1000) ÷ (F/1e6) = S·1000/F
  return n > BigInt(1_000_000_000) ? 1_000_000_000 : Number(n);
}
