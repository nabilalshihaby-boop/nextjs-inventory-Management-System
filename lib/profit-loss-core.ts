// Profit & Loss — the pure accounting engine (no database, no I/O, no floating point).
//
// Costing policy: perpetual MOVING WEIGHTED AVERAGE per product, company-wide, in BASE units.
// Money is BigInt cents (2 dp) and quantity is BigInt thousandths (3 dp, the stored precision), so every figure
// is exact and every division rounds half-up in ONE documented place (mulDiv).
//
// The state of one product is a single pool: `qty` units on hand, `value` cents of KNOWN cost for the costed units,
// and `unc` = how many of those units have NO trustworthy cost (opening stock recorded before cost snapshots
// existed, stock that exists without any recorded movement, stock bought in another currency). While `unc > 0`
// the average is unreliable, so every cost that would be read from the pool is reported as UNAVAILABLE (null) —
// the engine never substitutes the product's current cost. The pool becomes clean again when it is empty.
//
// Events are replayed in the SAME deterministic order the stock ledger uses: business day, record timestamp,
// reference, in-document order (then input order). A back-dated purchase therefore re-prices every later sale.

export type CostKind = "BASELINE" | "OPENING" | "PURCHASE" | "PURCHASE_RETURN" | "SALE" | "SALE_RETURN" | "ADJ_ADD" | "ADJ_SUB" | "UNEXPLAINED";

export type CostEvent = {
  productId: string;
  day: string; // YYYY-MM-DD
  at: number;
  ref: string;
  ord: number;
  kind: CostKind;
  /** Base-unit quantity in thousandths, always positive. */
  qty: bigint;
  /**
   * OPENING / PURCHASE: the cost value of `qty` in cents, or null when it can't be trusted (no snapshot, other currency).
   * PURCHASE_RETURN: unused (see lineQty / lineValue).
   */
  value: bigint | null;
  /** The document line this event belongs to — returns refer back to the sale / purchase line they reverse. */
  lineKey?: string;
  /** PURCHASE_RETURN: the ORIGINAL purchase line (base qty, cost value in cents or null). */
  lineQty?: bigint;
  lineValue?: bigint | null;
  /** BASELINE: the Owner's cost per Base Unit in cents. From this moment on the units that are STILL uncosted are valued at it. */
  unitCost?: bigint;
  /**
   * OPENING / PURCHASE / UNEXPLAINED with `value: null`: true when the cost is missing because the units have NO MATCHING CURRENCY
   * cost basis (an other-currency purchase, or currencyless legacy stock seen from a non-default currency). False/absent = the cost
   * was simply never recorded.
   */
  foreign?: boolean;
  /** True when the event belongs to the report currency (sales / returns of other currencies still move the pool). */
  reported: boolean;
};

export type CostIssue = { productId: string; day: string; ref: string; kind: "NEGATIVE_STOCK"; balance: bigint };
export type CostReason = "NO_CURRENCY_BASIS";
export type CostResult = {
  ev: CostEvent;
  /** SALE: COGS · SALE_RETURN: COGS reversed · ADJ_ADD: gain · ADJ_SUB: loss. null = unavailable. undefined = not a P&L cost event. */
  cost: bigint | null | undefined;
  /** Why a cost is unavailable when the product's stock has no matching currency cost basis (ambiguous provenance); absent = never recorded. */
  reason?: CostReason;
};

const ZERO = BigInt(0);
const TWO = BigInt(2);
const B1000 = BigInt(1000);

/** round(a × b ÷ d), half-up, for non-negative values. */
export function mulDiv(a: bigint, b: bigint, d: bigint): bigint {
  if (d === ZERO) return ZERO;
  return (a * b * TWO + d) / (d * TWO);
}
const min = (a: bigint, b: bigint) => (a < b ? a : b);

export const compareCostEvents = (a: CostEvent, b: CostEvent) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.at - b.at || a.ref.localeCompare(b.ref) || a.ord - b.ord);

/** Replays ONE product's events (any order in; deterministic order out). */
export type CostFinal = { qty: bigint; unc: bigint; value: bigint };
export function runCosting(events: CostEvent[]): { results: CostResult[]; issues: CostIssue[]; final: CostFinal } {
  const sorted = events.map((e, i) => ({ e, i })).sort((x, y) => compareCostEvents(x.e, y.e) || x.i - y.i).map((x) => x.e);
  let qty = ZERO;
  let value = ZERO;
  let unc = ZERO;
  let uncF = ZERO; // the part of `unc` that has no matching currency cost basis (ambiguous provenance)
  let lastForeign = false; // did the last draw touch a pool that contains such units?
  let last = null as { v: bigint; q: bigint } | null; // last clean average, as a fraction (used to value a gain while the pool is empty)
  const saleLines = new Map<string, { qty: bigint; cost: bigint | null; foreign: boolean; retQty: bigint; retCost: bigint }>();
  const purchaseLines = new Map<string, { retQty: bigint; retValue: bigint }>();
  const results: CostResult[] = [];
  const issues: CostIssue[] = [];

  const refresh = () => {
    if (qty === ZERO) {
      value = ZERO;
      unc = ZERO;
      uncF = ZERO;
    } else if (unc === ZERO) last = { v: value, q: qty };
  };

  /** Takes `q` units out of the pool; returns their cost, or null when it can't be known. */
  const draw = (q: bigint, ev: CostEvent): bigint | null => {
    lastForeign = false;
    if (q > qty) {
      issues.push({ productId: ev.productId, day: ev.day, ref: ev.ref, kind: "NEGATIVE_STOCK", balance: qty - q });
      qty = ZERO;
      refresh();
      return null;
    }
    const tainted = unc > ZERO;
    lastForeign = tainted && uncF > ZERO;
    const cq = qty - unc; // costed units
    const u = tainted ? min(unc, mulDiv(q, unc, qty)) : ZERO;
    const cs = min(q - u, cq);
    const costed = cq > ZERO ? (cs === cq ? value : mulDiv(value, cs, cq)) : ZERO;
    value -= costed;
    qty -= q;
    if (tainted && unc > ZERO) uncF -= min(uncF, mulDiv(uncF, u, unc));
    unc -= u;
    refresh();
    return tainted ? null : costed;
  };

  for (const ev of sorted) {
    switch (ev.kind) {
      case "BASELINE": {
        // Accounting cutover: the units that are uncosted AT THIS MOMENT get the Owner's cost. Nothing before this
        // event is re-priced; no quantity changes; it is not a P&L line.
        if (unc > ZERO) {
          value += mulDiv(unc, ev.unitCost ?? ZERO, B1000);
          unc = ZERO;
          uncF = ZERO;
          refresh();
        }
        results.push({ ev, cost: undefined });
        break;
      }
      case "OPENING":
      case "PURCHASE": {
        qty += ev.qty;
        if (ev.value === null) {
          unc += ev.qty;
          if (ev.foreign) uncF += ev.qty;
        } else value += ev.value;
        refresh();
        results.push({ ev, cost: undefined });
        break;
      }
      case "UNEXPLAINED": {
        qty += ev.qty;
        unc += ev.qty;
        if (ev.foreign) uncF += ev.qty;
        refresh();
        results.push({ ev, cost: undefined });
        break;
      }
      case "PURCHASE_RETURN": {
        // Out at the ORIGINAL purchase cost (cumulative share of that line), not at today's average.
        const key = ev.lineKey ?? "";
        const t = purchaseLines.get(key) ?? { retQty: ZERO, retValue: ZERO };
        const origQty = ev.lineQty ?? ev.qty;
        let rv: bigint | null = null;
        if (ev.lineValue !== null && ev.lineValue !== undefined) rv = t.retQty + ev.qty >= origQty ? ev.lineValue - t.retValue : mulDiv(ev.lineValue, ev.qty, origQty);
        t.retQty += ev.qty;
        if (rv !== null) t.retValue += rv;
        purchaseLines.set(key, t);
        if (ev.qty > qty) {
          issues.push({ productId: ev.productId, day: ev.day, ref: ev.ref, kind: "NEGATIVE_STOCK", balance: qty - ev.qty });
          qty = ZERO;
          refresh();
        } else if (rv === null) {
          // The returned units were the uncosted ones (other-currency purchase): they leave the uncosted part first.
          const r = min(ev.qty, unc);
          unc -= r;
          uncF -= min(uncF, r);
          qty -= ev.qty;
          refresh();
        } else {
          value = value > rv ? value - rv : ZERO;
          qty -= ev.qty;
          refresh();
        }
        results.push({ ev, cost: rv });
        break;
      }
      case "SALE": {
        const cost = draw(ev.qty, ev);
        const foreign = cost === null && lastForeign;
        if (ev.lineKey) saleLines.set(ev.lineKey, { qty: ev.qty, cost, foreign, retQty: ZERO, retCost: ZERO });
        results.push({ ev, cost, reason: foreign ? "NO_CURRENCY_BASIS" : undefined });
        break;
      }
      case "SALE_RETURN": {
        // Back into stock at the ORIGINAL sale's cost basis (cumulative share of that line).
        const line = ev.lineKey ? saleLines.get(ev.lineKey) : undefined;
        let restored: bigint | null = null;
        if (line && line.cost !== null) {
          restored = line.retQty + ev.qty >= line.qty ? line.cost - line.retCost : mulDiv(line.cost, ev.qty, line.qty);
          line.retCost += restored;
        }
        if (line) line.retQty += ev.qty;
        qty += ev.qty;
        if (restored === null) {
          unc += ev.qty;
          if (line?.foreign) uncF += ev.qty;
        } else value += restored;
        refresh();
        results.push({ ev, cost: restored, reason: restored === null && line?.foreign ? "NO_CURRENCY_BASIS" : undefined });
        break;
      }
      case "ADJ_ADD": {
        let gain: bigint | null = null;
        const foreign = unc > ZERO && uncF > ZERO;
        if (unc === ZERO && qty > ZERO) gain = mulDiv(value, ev.qty, qty);
        else if (unc === ZERO && qty === ZERO && last) gain = mulDiv(last.v, ev.qty, last.q);
        qty += ev.qty;
        if (gain === null) {
          unc += ev.qty;
          if (foreign) uncF += ev.qty;
        } else value += gain;
        refresh();
        results.push({ ev, cost: gain, reason: gain === null && foreign ? "NO_CURRENCY_BASIS" : undefined });
        break;
      }
      case "ADJ_SUB": {
        const c = draw(ev.qty, ev);
        results.push({ ev, cost: c, reason: c === null && lastForeign ? "NO_CURRENCY_BASIS" : undefined });
        break;
      }
    }
  }
  return { results, issues, final: { qty, unc, value } };
}

// ---------------------------------------------------------------------------------------------
// The statement
// ---------------------------------------------------------------------------------------------

export type RevenueDoc = {
  day: string;
  kind: "SALE" | "SALE_RETURN";
  /** Σ line (subtotal − tax): net of line discounts, excluding tax. Cents. */
  net: bigint;
  /** Sale: the order-level discount given. Return: the order-level discount share handed back. Cents. */
  orderDiscount: bigint;
  /** Sale only (shipping is never returned). Cents. */
  shipping: bigint;
  /** Line tax + order tax stored on the document. Cents. */
  tax: bigint;
};
export type PurchaseTaxDoc = { day: string; kind: "PURCHASE" | "PURCHASE_RETURN"; tax: bigint };
export type ExpenseDoc = { day: string; categoryId: string; categoryName: string; amount: bigint };
export type UnavailableItem = { productId: string; day: string; ref: string; kind: "SALE" | "SALE_RETURN" | "ADJ_ADD" | "ADJ_SUB"; reason?: CostReason };

export type Statement = {
  sales: bigint;
  orderDiscounts: bigint;
  salesReturns: bigint;
  netSales: bigint;
  cogsSales: bigint;
  cogsReturns: bigint;
  cogs: bigint;
  grossProfit: bigint;
  shippingIncome: bigint;
  adjustmentGains: bigint;
  adjustmentLosses: bigint;
  expenses: { categoryId: string; categoryName: string; amount: bigint }[];
  totalExpenses: bigint;
  netProfit: bigint;
  taxCollected: bigint;
  taxPaid: bigint;
  /** True when every cost the period needs was known: only then are Gross Profit / Net Profit real figures. */
  costComplete: boolean;
  unavailable: UnavailableItem[];
  activity: { sales: number; salesReturns: number; adjustments: number; expenses: number };
};

const inPeriod = (day: string, from: string, to: string) => day >= from && day <= to;

/** Builds the P&L of [from, to] (inclusive) from already-classified source documents and the costing results. */
export function buildStatement(input: {
  from: string;
  to: string;
  revenue: RevenueDoc[];
  purchaseTax: PurchaseTaxDoc[];
  expenses: ExpenseDoc[];
  costs: CostResult[];
  /** Any unresolved integrity problem (e.g. a negative historical stock balance) makes the cost side incomplete. */
  hasIntegrityIssue: boolean;
}): Statement {
  const { from, to } = input;
  let sales = ZERO;
  let orderDiscounts = ZERO;
  let salesReturns = ZERO;
  let shippingIncome = ZERO;
  let taxCollected = ZERO;
  let taxPaid = ZERO;
  let nSales = 0;
  let nReturns = 0;
  for (const d of input.revenue) {
    if (!inPeriod(d.day, from, to)) continue;
    if (d.kind === "SALE") {
      nSales++;
      sales += d.net;
      orderDiscounts += d.orderDiscount;
      shippingIncome += d.shipping;
      taxCollected += d.tax;
    } else {
      nReturns++;
      salesReturns += d.net - d.orderDiscount;
      taxCollected -= d.tax;
    }
  }
  for (const d of input.purchaseTax) {
    if (!inPeriod(d.day, from, to)) continue;
    taxPaid += d.kind === "PURCHASE" ? d.tax : -d.tax;
  }

  let cogsSales = ZERO;
  let cogsReturns = ZERO;
  let adjustmentGains = ZERO;
  let adjustmentLosses = ZERO;
  let nAdj = 0;
  const unavailable: UnavailableItem[] = [];
  for (const r of input.costs) {
    const e = r.ev;
    if (!e.reported || !inPeriod(e.day, from, to)) continue;
    if (e.kind !== "SALE" && e.kind !== "SALE_RETURN" && e.kind !== "ADJ_ADD" && e.kind !== "ADJ_SUB") continue;
    if (e.kind === "ADJ_ADD" || e.kind === "ADJ_SUB") nAdj++;
    if (r.cost === null || r.cost === undefined) {
      unavailable.push({ productId: e.productId, day: e.day, ref: e.ref, kind: e.kind, reason: r.reason });
      continue;
    }
    if (e.kind === "SALE") cogsSales += r.cost;
    else if (e.kind === "SALE_RETURN") cogsReturns += r.cost;
    else if (e.kind === "ADJ_ADD") adjustmentGains += r.cost;
    else adjustmentLosses += r.cost;
  }

  const byCat = new Map<string, { categoryId: string; categoryName: string; amount: bigint }>();
  let nExp = 0;
  for (const x of input.expenses) {
    if (!inPeriod(x.day, from, to)) continue;
    nExp++;
    const c = byCat.get(x.categoryId) ?? { categoryId: x.categoryId, categoryName: x.categoryName, amount: ZERO };
    c.amount += x.amount;
    byCat.set(x.categoryId, c);
  }
  const expenses = [...byCat.values()].sort((a, b) => a.categoryName.localeCompare(b.categoryName));
  const totalExpenses = expenses.reduce((n, c) => n + c.amount, ZERO);

  const netSales = sales - orderDiscounts - salesReturns;
  const cogs = cogsSales - cogsReturns;
  const grossProfit = netSales - cogs;
  const netProfit = grossProfit + shippingIncome + adjustmentGains - adjustmentLosses - totalExpenses;
  return {
    sales,
    orderDiscounts,
    salesReturns,
    netSales,
    cogsSales,
    cogsReturns,
    cogs,
    grossProfit,
    shippingIncome,
    adjustmentGains,
    adjustmentLosses,
    expenses,
    totalExpenses,
    netProfit,
    taxCollected,
    taxPaid,
    costComplete: unavailable.length === 0 && !input.hasIntegrityIssue,
    unavailable,
    activity: { sales: nSales, salesReturns: nReturns, adjustments: nAdj, expenses: nExp },
  };
}

export const hasAnyActivity = (s: Statement) => s.activity.sales + s.activity.salesReturns + s.activity.adjustments + s.activity.expenses > 0;
