// Purchase-return amounts in exact scaled-BigInt arithmetic (client preview + authoritative server
// calculation — the same function). Every amount is a share of the ORIGINAL purchase's stored
// snapshot, computed cumulatively so that rounding never drifts:
//
//   share(X) = round(X × after ÷ total) − round(X × before ÷ total)
//
// where `before` is what was already returned and `after = before + this return`. Returning a
// line in several parts therefore adds up to exactly the original line subtotal / tax / discount,
// and the order-level tax and discount are shared out the same way by returned subtotal. Shipping
// is not returned. Money: cents; quantity: thousandths.
import { fromUnits, toUnits } from "@/lib/transfers";

const B = (n: number) => BigInt(n);
const round = (a: bigint, b: bigint, d: bigint) => (d === B(0) ? B(0) : (a * b * B(2) + d) / (d * B(2)));
const share = (x: bigint, before: bigint, after: bigint, total: bigint) => round(x, after, total) - round(x, before, total);

export type OriginalLine = {
  /** Original purchased quantity (3 dp) and the line's stored amounts (2 dp). */
  quantity: string;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  /** Quantity already returned by earlier returns (3 dp). */
  returned: string;
};
export type ReturnLineResult = { subtotal: string; taxAmount: string; discountAmount: string; error?: string };
export type OriginalPurchase = {
  subtotal: string;
  orderTaxAmount: string;
  discount: string;
  /** Σ subtotal of the purchase's earlier returns (2 dp). */
  returnedSubtotal: string;
};
export type ReturnResult = { lines: ReturnLineResult[]; subtotal: string; orderTaxAmount: string; discount: string; shipping: string; grandTotal: string };

export function calcReturnLine(o: OriginalLine, quantity: string): ReturnLineResult {
  const total = toUnits(o.quantity, 3);
  const before = toUnits(o.returned, 3);
  const after = before + toUnits(quantity, 3);
  const r = {
    subtotal: fromUnits(share(toUnits(o.subtotal, 2), before, after, total), 2),
    taxAmount: fromUnits(share(toUnits(o.taxAmount, 2), before, after, total), 2),
    discountAmount: fromUnits(share(toUnits(o.discountAmount, 2), before, after, total), 2),
  };
  return after > total ? { ...r, error: "More than the returnable quantity" } : r;
}

export function calcReturn(p: OriginalPurchase, lines: { original: OriginalLine; quantity: string }[]): ReturnResult {
  const res = lines.map((l) => calcReturnLine(l.original, l.quantity));
  const sub = res.reduce((a, r) => a + toUnits(r.subtotal, 2), B(0));
  const total = toUnits(p.subtotal, 2);
  const before = toUnits(p.returnedSubtotal, 2);
  const after = before + sub;
  const tax = share(toUnits(p.orderTaxAmount, 2), before, after, total);
  const disc = share(toUnits(p.discount, 2), before, after, total);
  const grand = sub + tax - disc;
  return {
    lines: res,
    subtotal: fromUnits(sub, 2),
    orderTaxAmount: fromUnits(tax, 2),
    discount: fromUnits(disc, 2),
    shipping: "0.00",
    grandTotal: fromUnits(grand < B(0) ? B(0) : grand, 2),
  };
}
