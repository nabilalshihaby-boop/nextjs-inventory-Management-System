// Purchase totals in exact scaled-BigInt arithmetic (client preview + authoritative server
// calculation — the same function, so both always agree). Money: 2 dp (cents); quantity: 3 dp;
// percentages: 2 dp (14.50% → 1450). Every rounding step is half-up to the cent.
import { fromUnits, toUnits } from "@/lib/transfers";

export type LineInput = {
  quantity: string;
  unitCost: string;
  taxType: "EXCLUSIVE" | "INCLUSIVE";
  taxRate: string;
  discountType: "FIXED" | "PERCENTAGE";
  discountValue: string;
};
export type LineResult = { base: string; discountAmount: string; taxAmount: string; subtotal: string; netUnitCost: string; error?: string; /** Dictionary key for `error` (used by localized modules). */ errorKey?: string };
export type OrderInput = { orderTaxRate: string; discount: string; shipping: string };
export type OrderResult = { lines: LineResult[]; subtotal: string; orderTaxAmount: string; grandTotal: string; error?: string; errorKey?: string };

const B = (n: number) => BigInt(n);
/** round(a × b ÷ d), half-up, for non-negative values. */
const mulDiv = (a: bigint, b: bigint, d: bigint) => (a * b * B(2) + d) / (d * B(2));
const cents = (v: bigint) => fromUnits(v, 2);

export function calcLine(l: LineInput): LineResult {
  const qty = toUnits(l.quantity, 3);
  const cost = toUnits(l.unitCost, 2);
  const base = mulDiv(qty, cost, B(1000)); // cents
  const discountAmount = l.discountType === "FIXED" ? toUnits(l.discountValue, 2) : mulDiv(base, toUnits(l.discountValue, 2), B(10000));
  const taxable = base - discountAmount;
  const rate = toUnits(l.taxRate, 2);
  if (taxable < B(0)) return { base: cents(base), discountAmount: cents(discountAmount), taxAmount: "0.00", subtotal: "0.00", netUnitCost: "0.00", error: "Discount can't exceed the line amount", errorKey: "sales.err.calcLineDiscount" };
  // Exclusive: tax is added on top. Inclusive: the price already contains the tax.
  const tax = l.taxType === "EXCLUSIVE" ? mulDiv(taxable, rate, B(10000)) : mulDiv(taxable, rate, B(10000) + rate);
  const subtotal = l.taxType === "EXCLUSIVE" ? taxable + tax : taxable;
  const net = qty > B(0) ? mulDiv(subtotal, B(1000), qty) : B(0);
  return { base: cents(base), discountAmount: cents(discountAmount), taxAmount: cents(tax), subtotal: cents(subtotal), netUnitCost: cents(net) };
}

export function calcOrder(lines: LineInput[], o: OrderInput): OrderResult {
  const res = lines.map(calcLine);
  const sub = res.reduce((a, r) => a + toUnits(r.subtotal, 2), B(0));
  const orderTax = mulDiv(sub, toUnits(o.orderTaxRate, 2), B(10000));
  const grand = sub + orderTax - toUnits(o.discount, 2) + toUnits(o.shipping, 2);
  const lineError = res.find((r) => r.error)?.error;
  const lineErrorKey = res.find((r) => r.error)?.errorKey;
  return {
    lines: res,
    subtotal: cents(sub),
    orderTaxAmount: cents(orderTax),
    grandTotal: cents(grand < B(0) ? B(0) : grand),
    error: lineError ?? (grand < B(0) ? "The discount can't exceed the order total" : undefined),
    errorKey: lineError ? lineErrorKey : grand < B(0) ? "sales.err.calcOrderDiscount" : undefined,
  };
}
