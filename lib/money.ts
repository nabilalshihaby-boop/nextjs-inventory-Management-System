// Display helpers for Prisma Decimal values (as strings) — no floating-point arithmetic.

/** Group thousands of a non-negative decimal string and fix the fraction to `scale` digits. */
export function formatDecimal(value: string, scale: number): string {
  const [intPart, frac = ""] = value.split(".");
  const grouped = intPart.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return scale ? `${grouped}.${(frac + "0".repeat(scale)).slice(0, scale)}` : grouped;
}

/** Quantity without trailing zeros: "100.000" → "100", "2.500" → "2.5". */
export function formatQuantity(value: string): string {
  const [i, f = ""] = value.split(".");
  const frac = f.replace(/0+$/, "");
  return formatDecimal(i, 0) + (frac ? `.${frac}` : "");
}

export type CurrencyDisplay = { code: string; symbol: string; right: boolean };

/** "EGP 1,790.00" (or "1,790.00 EGP" when the currency icon is configured on the right). */
export function formatMoney(value: string, currency: CurrencyDisplay | null): string {
  const n = formatDecimal(value, 2);
  if (!currency) return n;
  return currency.right ? `${n} ${currency.symbol}` : `${currency.symbol} ${n}`;
}
