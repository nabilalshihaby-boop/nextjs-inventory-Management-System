import type { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { isRealIsoDate } from "@/lib/inventory-report-core";
import { dayOfDateOnly, dayOfTimestamp } from "@/lib/inventory-reports";
import { buildStatement, runCosting, type CostEvent, type CostIssue, type CostResult, type ExpenseDoc, type PurchaseTaxDoc, type RevenueDoc, type Statement } from "@/lib/profit-loss-core";
import { fromUnits, lineTotalCents, toUnits } from "@/lib/transfers";

// Profit & Loss — READ-ONLY data access. Nothing in this file writes. It rebuilds the company-wide cost history
// of every product from the immutable source documents (the same documents and the same chronological order as the
// Stock Card, lib/inventory-reports.ts), replays it with the Moving Weighted Average engine (lib/profit-loss-core.ts)
// and returns one currency at a time. Cash & Bank movements, payments, deposits, withdrawals, transfers, register
// activity and POS cash handling are never read: they are not income or expense.

const B = (n: number) => BigInt(n);

// ---------------------------------------------------------------------------------------------
// Query parameters (validated here AND by the report route; the client form is only a convenience)
// ---------------------------------------------------------------------------------------------

export type PlQueryError = "errFrom" | "errTo" | "errDate" | "errDateOrder" | "errCurrency" | "errCurrencyRequired";
type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim().slice(0, 64) : "");

export type PlParams = { from: string; to: string; currencyId: string };
export function parsePlParams(sp: Raw): { ok: true; p: PlParams } | { ok: false; error: PlQueryError } {
  const from = one(sp.from);
  const to = one(sp.to);
  if (!from) return { ok: false, error: "errFrom" };
  if (!to) return { ok: false, error: "errTo" };
  if (!isRealIsoDate(from) || !isRealIsoDate(to)) return { ok: false, error: "errDate" };
  if (from > to) return { ok: false, error: "errDateOrder" };
  return { ok: true, p: { from, to, currencyId: one(sp.currency) } };
}

export type PlCurrency = { id: string; code: string; symbol: string; name: string };

/** Currencies that have at least one P&L-relevant record (completed sale / return, received purchase / return, expense). */
export async function getActiveCurrencies(): Promise<{ currencies: PlCurrency[]; defaultId: string | null; iconRight: boolean }> {
  const [sales, saleReturns, purchases, purchaseReturns, expenseAccounts, settings] = await Promise.all([
    db.sale.groupBy({ by: ["currencyId"], where: { status: "COMPLETED" } }),
    db.saleReturn.groupBy({ by: ["currencyId"] }),
    db.purchase.groupBy({ by: ["currencyId"], where: { status: "RECEIVED" } }),
    db.purchaseReturn.groupBy({ by: ["currencyId"] }),
    db.expense.findMany({ where: { deletedAt: null }, distinct: ["cashBankAccountId"], select: { cashBankAccount: { select: { currencyId: true } } } }),
    db.systemSettings.findUnique({ where: { id: 1 }, select: { defaultCurrencyId: true, currencyIconRight: true } }),
  ]);
  const ids = new Set<string>([...sales, ...saleReturns, ...purchases, ...purchaseReturns].map((g) => g.currencyId));
  for (const e of expenseAccounts) ids.add(e.cashBankAccount.currencyId);
  if (ids.size === 0 && settings?.defaultCurrencyId) ids.add(settings.defaultCurrencyId);
  const currencies = await db.currency.findMany({ where: { id: { in: [...ids] } }, orderBy: { code: "asc" }, select: { id: true, code: true, symbol: true, name: true } });
  return { currencies, defaultId: settings?.defaultCurrencyId ?? null, iconRight: settings?.currencyIconRight ?? false };
}

/** Which currency a request means: the explicit one, else the only one in use. null = the user must choose. */
export function resolveCurrency(requestedId: string, active: PlCurrency[]): { ok: true; currency: PlCurrency } | { ok: false; error: "errCurrency" | "errCurrencyRequired" } {
  if (requestedId) {
    const c = active.find((x) => x.id === requestedId);
    return c ? { ok: true, currency: c } : { ok: false, error: "errCurrency" };
  }
  if (active.length === 1) return { ok: true, currency: active[0] };
  // Several currencies are in use: they are never combined, so the user must pick exactly one.
  return { ok: false, error: active.length === 0 ? "errCurrency" : "errCurrencyRequired" };
}

// ---------------------------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------------------------

export type Money = string; // "1234.50", signed, 2 dp
export type PlUnavailableRow = { productId: string; code: string; name: string; documents: number; refs: string[]; /** NO_CURRENCY_BASIS = the product also has stock with no matching currency cost basis (ambiguous provenance); UNKNOWN_COST = the cost was never recorded. */ reason: "NO_CURRENCY_BASIS" | "UNKNOWN_COST" };
export type PlIssueRow = { code: string; name: string; day: string; ref: string };

export type ProfitLossReport = {
  from: string;
  to: string;
  currency: PlCurrency & { right: boolean };
  /** Every figure is null while the cost side is incomplete — Gross Profit / Net Profit are then NOT shown as numbers. */
  costComplete: boolean;
  empty: boolean;
  lines: {
    sales: Money;
    orderDiscounts: Money;
    salesReturns: Money;
    netSales: Money;
    cogsSales: Money;
    cogsReturns: Money;
    cogs: Money;
    grossProfit: Money | null;
    shippingIncome: Money;
    adjustmentGains: Money;
    adjustmentLosses: Money;
    expenses: { categoryId: string; name: string; amount: Money }[];
    totalExpenses: Money;
    netProfit: Money | null;
  };
  tax: { collected: Money; paid: Money };
  unavailable: PlUnavailableRow[];
  issues: PlIssueRow[];
  /** Opening cost baselines of THIS currency (Owner-set): stock valued from their moment on; earlier history stays unavailable. */
  baselines: { code: string; name: string; effectiveAt: string; unitCost: Money; quantity: string }[];
  activity: Statement["activity"];
};

const m = (v: bigint): Money => fromUnits(v, 2);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

export type BaselineRow = { id: string; productId: string; currencyId: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal; totalValue: Prisma.Decimal; effectiveAt: Date; createdById: string };
export type CostHistory = {
  byProduct: Map<string, CostEvent[]>;
  issueRows: { productId: string; day: string; ref: string }[];
  baselines: BaselineRow[];
};

/**
 * Every cost-relevant event of every product (company-wide, all currencies), classified for ONE report currency R.
 * Read-only; `client` is the database or a transaction (the Owner setup re-reads it inside its own transaction).
 */
export async function loadCostHistory(client: Prisma.TransactionClient, R: string, defaultCurrencyId: string | null): Promise<CostHistory> {
  const assumeOpeningInR = defaultCurrencyId === R; // opening-stock costs have no currency of their own: they are in the system default currency

  const [entries, purchaseItems, purchaseReturnItems, saleItems, saleReturnItems, adjustmentItems, sentTransferItems, stocks] = await Promise.all([
    client.productStockEntry.findMany({ where: { status: "RECEIVED" }, select: { id: true, productId: true, quantity: true, unitCost: true, createdAt: true } }),
    client.purchaseItem.findMany({
      where: { purchase: { status: "RECEIVED" } },
      select: { id: true, productId: true, baseQuantity: true, subtotal: true, taxAmount: true, purchase: { select: { reference: true, receivedAt: true, createdAt: true, currencyId: true } } },
    }),
    client.purchaseReturnItem.findMany({
      select: {
        purchaseItemId: true,
        productId: true,
        baseQuantity: true,
        purchaseReturn: { select: { reference: true, returnDate: true, createdAt: true, currencyId: true } },
        purchaseItem: { select: { baseQuantity: true, subtotal: true, taxAmount: true, purchase: { select: { currencyId: true } } } },
      },
    }),
    client.saleItem.findMany({
      where: { sale: { status: "COMPLETED" } },
      select: { id: true, productId: true, baseQuantity: true, sale: { select: { reference: true, completedAt: true, saleDate: true, createdAt: true, currencyId: true } } },
    }),
    client.saleReturnItem.findMany({
      select: { saleItemId: true, productId: true, baseQuantity: true, saleReturn: { select: { reference: true, returnDate: true, createdAt: true, currencyId: true } } },
    }),
    client.stockAdjustmentItem.findMany({ select: { productId: true, baseQuantity: true, type: true, adjustment: { select: { reference: true, adjustmentDate: true, createdAt: true } } } }),
    client.stockTransferItem.findMany({ where: { transfer: { status: "SENT" } }, select: { productId: true, baseQuantity: true } }),
    client.productStock.groupBy({ by: ["productId"], _sum: { quantity: true } }),
  ]);
  const baselines = await client.inventoryCostBaseline.findMany();

  // ---- cost events ----
  const events: CostEvent[] = [];
  const docCur = new Map<string, Set<string>>(); // the currencies of every purchase / sale / return document of a product
  const markDoc = (productId: string, cur: string) => {
    const s = docCur.get(productId) ?? new Set<string>();
    s.add(cur);
    docCur.set(productId, s);
    if (cur === R) relevant.add(productId);
  };
  const relevant = new Set<string>(); // products with any activity in THIS currency (others are not part of this report)
  // Relevant to this currency: real activity in it, or — for the System Settings DEFAULT currency only — currencyless legacy stock
  // (opening entries / stock with no recorded movement) and products that have no purchase, sale or return in ANY currency.
  // Currencyless stock is never attributed to another currency and no exchange rate is ever invented.
  const isRel = (id: string) => relevant.has(id) || (!docCur.has(id) && assumeOpeningInR);
  const sumQty = new Map<string, bigint>(); // Σ of every movement per product (company-wide) for the unexplained-stock check

  const add = (e: CostEvent, signed: bigint) => {
    events.push(e);
    sumQty.set(e.productId, (sumQty.get(e.productId) ?? B(0)) + signed);
  };

  for (const e of entries) {
    const q = toUnits(e.quantity.toFixed(3), 3);
    const known = e.unitCost !== null && assumeOpeningInR;
    if (assumeOpeningInR) relevant.add(e.productId);
    add({ productId: e.productId, day: dayOfTimestamp(e.createdAt), at: e.createdAt.getTime(), ref: "", ord: 0, kind: "OPENING", qty: q, value: known ? lineTotalCents(e.quantity.toFixed(3), e.unitCost!.toFixed(2)) : null, foreign: !assumeOpeningInR, reported: true }, q);
  }
  for (const i of purchaseItems) {
    const pu = i.purchase;
    const when = pu.receivedAt ?? pu.createdAt;
    const q = toUnits(i.baseQuantity.toFixed(3), 3);
    const sameCur = pu.currencyId === R;
    markDoc(i.productId, pu.currencyId);
    // Actual stored line cost: line subtotal (after the line discount) without tax — the purchase's own snapshot, never Product.cost.
    const value = toUnits(i.subtotal.toFixed(2), 2) - toUnits(i.taxAmount.toFixed(2), 2);
    add({ productId: i.productId, day: dayOfTimestamp(when), at: when.getTime(), ref: pu.reference, ord: 0, kind: "PURCHASE", qty: q, value: sameCur ? value : null, foreign: !sameCur, reported: sameCur }, q);
  }
  for (const i of purchaseReturnItems) {
    const r = i.purchaseReturn;
    const q = toUnits(i.baseQuantity.toFixed(3), 3);
    const sameCur = r.currencyId === R;
    markDoc(i.productId, r.currencyId);
    const origValue = toUnits(i.purchaseItem.subtotal.toFixed(2), 2) - toUnits(i.purchaseItem.taxAmount.toFixed(2), 2);
    add(
      { productId: i.productId, day: dayOfDateOnly(r.returnDate), at: r.createdAt.getTime(), ref: r.reference, ord: 0, kind: "PURCHASE_RETURN", qty: q, value: null, lineKey: i.purchaseItemId, lineQty: toUnits(i.purchaseItem.baseQuantity.toFixed(3), 3), lineValue: i.purchaseItem.purchase.currencyId === R ? origValue : null, reported: sameCur },
      -q,
    );
  }
  for (const i of saleItems) {
    const s = i.sale;
    const q = toUnits(i.baseQuantity.toFixed(3), 3);
    const sameCur = s.currencyId === R;
    markDoc(i.productId, s.currencyId);
    const day = s.completedAt ? dayOfTimestamp(s.completedAt) : dayOfDateOnly(s.saleDate);
    add({ productId: i.productId, day, at: (s.completedAt ?? s.createdAt).getTime(), ref: s.reference, ord: 0, kind: "SALE", qty: q, value: null, lineKey: i.id, reported: sameCur }, -q);
  }
  for (const i of saleReturnItems) {
    const r = i.saleReturn;
    const q = toUnits(i.baseQuantity.toFixed(3), 3);
    const sameCur = r.currencyId === R;
    markDoc(i.productId, r.currencyId);
    add({ productId: i.productId, day: dayOfDateOnly(r.returnDate), at: r.createdAt.getTime(), ref: r.reference, ord: 0, kind: "SALE_RETURN", qty: q, value: null, lineKey: i.saleItemId, reported: sameCur }, q);
  }
  for (const i of adjustmentItems) {
    const a = i.adjustment;
    const q = toUnits(i.baseQuantity.toFixed(3), 3);
    const add_ = i.type === "ADDITION";
    add({ productId: i.productId, day: dayOfDateOnly(a.adjustmentDate), at: a.createdAt.getTime(), ref: a.reference, ord: 0, kind: add_ ? "ADJ_ADD" : "ADJ_SUB", qty: q, value: null, reported: true }, add_ ? q : -q);
  }

  // Owner-set opening cost baselines of THIS currency: from their cutover moment on, the still-uncosted units are valued at the
  // Owner's cost per Base Unit. Nothing before that moment is re-priced.
  for (const b of baselines) {
    if (b.currencyId !== R) continue;
    markDoc(b.productId, R);
    events.push({ productId: b.productId, day: dayOfTimestamp(b.effectiveAt), at: b.effectiveAt.getTime(), ref: "", ord: 0, kind: "BASELINE", qty: toUnits(b.quantity.toFixed(3), 3), value: null, unitCost: toUnits(b.unitCost.toFixed(2), 2), reported: true });
  }

  // Goods that left a warehouse on a SENT (not yet received) transfer are still owned by the company.
  const inTransit = new Map<string, bigint>();
  for (const t of sentTransferItems) inTransit.set(t.productId, (inTransit.get(t.productId) ?? B(0)) + toUnits(t.baseQuantity.toFixed(3), 3));

  // Stock that exists with NO recorded movement is an opening balance of unknown cost — never invented as a purchase.
  const issueRows: { productId: string; day: string; ref: string }[] = [];
  const stockOf = new Map(stocks.map((s) => [s.productId, s._sum.quantity ? toUnits(s._sum.quantity.toFixed(3), 3) : B(0)]));
  const productIds = new Set<string>([...sumQty.keys(), ...stockOf.keys()]);
  for (const id of productIds) {
    const variance = (stockOf.get(id) ?? B(0)) + (inTransit.get(id) ?? B(0)) - (sumQty.get(id) ?? B(0));
    if (variance > B(0)) {
      // Stock with no recorded movement has no currency. It belongs to the DEFAULT currency (relevant there, and eligible for setup there);
      // in any other currency it only matters when the product has real activity in that currency, where it is units with no matching
      // currency cost basis — so cost allocation for that product is unavailable, never estimated.
      events.push({ productId: id, day: "0000-00-00", at: 0, ref: "", ord: 0, kind: "UNEXPLAINED", qty: variance, value: null, foreign: !assumeOpeningInR, reported: true });
      if (assumeOpeningInR) relevant.add(id);
    }
    else if (variance < B(0) && isRel(id)) issueRows.push({ productId: id, day: "", ref: "" }); // recorded history exceeds the stock on hand
  }

  const byProduct = new Map<string, CostEvent[]>();
  for (const e of events) if (isRel(e.productId)) byProduct.set(e.productId, [...(byProduct.get(e.productId) ?? []), e]);
  return { byProduct, issueRows, baselines };
}

export async function getProfitLoss(p: PlParams & { currency: PlCurrency; iconRight: boolean; defaultCurrencyId: string | null }): Promise<ProfitLossReport> {
  const R = p.currency.id;
  // Generous DB window for the period-bound revenue/expense reads (the exact day test happens in JS, in the server's local day).
  const lo = addDays(new Date(`${p.from}T00:00:00.000Z`), -2);
  const hi = addDays(new Date(`${p.to}T00:00:00.000Z`), 3);

  const [sales, saleReturns, purchases, purchaseReturns, expenses] = await Promise.all([
    // Revenue: completed sales of THIS currency (POS sales are ordinary completed sales — counted once, here).
    db.sale.findMany({
      where: { status: "COMPLETED", currencyId: R, OR: [{ completedAt: { gte: lo, lte: hi } }, { completedAt: null, saleDate: { gte: lo, lte: hi } }] },
      select: { completedAt: true, saleDate: true, discount: true, shipping: true, orderTaxAmount: true, items: { select: { subtotal: true, taxAmount: true } } },
    }),
    db.saleReturn.findMany({ where: { currencyId: R, returnDate: { gte: lo, lte: hi } }, select: { returnDate: true, discount: true, orderTaxAmount: true, items: { select: { subtotal: true, taxAmount: true } } } }),
    db.purchase.findMany({
      where: { status: "RECEIVED", currencyId: R, OR: [{ receivedAt: { gte: lo, lte: hi } }, { receivedAt: null, createdAt: { gte: lo, lte: hi } }] },
      select: { receivedAt: true, createdAt: true, orderTaxAmount: true, items: { select: { taxAmount: true } } },
    }),
    db.purchaseReturn.findMany({ where: { currencyId: R, returnDate: { gte: lo, lte: hi } }, select: { returnDate: true, orderTaxAmount: true, items: { select: { taxAmount: true } } } }),
    // Operating expenses: real, active (not deleted) Expense records only, paid from an account of THIS currency.
    db.expense.findMany({ where: { deletedAt: null, expenseDate: { gte: lo, lte: hi }, cashBankAccount: { currencyId: R } }, select: { expenseDate: true, amount: true, categoryId: true, category: { select: { name: true } } } }),
  ]);

  // ---- cost history, replayed product by product ----
  const { byProduct, issueRows, baselines } = await loadCostHistory(db, R, p.defaultCurrencyId);
  const costs: CostResult[] = [];
  const issues: CostIssue[] = [];
  for (const [, list] of byProduct) {
    const r = runCosting(list);
    costs.push(...r.results);
    issues.push(...r.issues);
  }

  // ---- revenue / tax / expenses ----
  const effDay = (completedAt: Date | null, saleDate: Date) => (completedAt ? dayOfTimestamp(completedAt) : dayOfDateOnly(saleDate));
  const net = (items: { subtotal: { toFixed: (n: number) => string }; taxAmount: { toFixed: (n: number) => string } }[]) => items.reduce((a, i) => a + toUnits(i.subtotal.toFixed(2), 2) - toUnits(i.taxAmount.toFixed(2), 2), B(0));
  const tax = (items: { taxAmount: { toFixed: (n: number) => string } }[], order: { toFixed: (n: number) => string }) => items.reduce((a, i) => a + toUnits(i.taxAmount.toFixed(2), 2), B(0)) + toUnits(order.toFixed(2), 2);
  const revenue: RevenueDoc[] = [
    ...sales.map((s): RevenueDoc => ({ day: effDay(s.completedAt, s.saleDate), kind: "SALE", net: net(s.items), orderDiscount: toUnits(s.discount.toFixed(2), 2), shipping: toUnits(s.shipping.toFixed(2), 2), tax: tax(s.items, s.orderTaxAmount) })),
    ...saleReturns.map((r): RevenueDoc => ({ day: dayOfDateOnly(r.returnDate), kind: "SALE_RETURN", net: net(r.items), orderDiscount: toUnits(r.discount.toFixed(2), 2), shipping: B(0), tax: tax(r.items, r.orderTaxAmount) })),
  ];
  const purchaseTax: PurchaseTaxDoc[] = [
    ...purchases.map((x): PurchaseTaxDoc => ({ day: dayOfTimestamp(x.receivedAt ?? x.createdAt), kind: "PURCHASE", tax: tax(x.items, x.orderTaxAmount) })),
    ...purchaseReturns.map((x): PurchaseTaxDoc => ({ day: dayOfDateOnly(x.returnDate), kind: "PURCHASE_RETURN", tax: tax(x.items, x.orderTaxAmount) })),
  ];
  const expenseDocs: ExpenseDoc[] = expenses.map((x) => ({ day: dayOfDateOnly(x.expenseDate), categoryId: x.categoryId, categoryName: x.category.name, amount: toUnits(x.amount.toFixed(2), 2) }));

  const st = buildStatement({ from: p.from, to: p.to, revenue, purchaseTax, expenses: expenseDocs, costs, hasIntegrityIssue: issues.length > 0 || issueRows.length > 0 });

  // ---- names for the affected products ----
  const ownBaselines = baselines.filter((b) => b.currencyId === R && b.effectiveAt.getTime() <= new Date(`${p.to}T23:59:59.999Z`).getTime() + 86400000);
  const ids = [...new Set([...st.unavailable.map((u) => u.productId), ...issues.map((i) => i.productId), ...issueRows.map((i) => i.productId), ...ownBaselines.map((b) => b.productId)])];
  const names = new Map((await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } })).map((x) => [x.id, x]));
  const unavailable = new Map<string, PlUnavailableRow>();
  for (const u of st.unavailable) {
    const pr = names.get(u.productId);
    const row = unavailable.get(u.productId) ?? { productId: u.productId, code: pr?.code ?? "", name: pr?.name ?? "", documents: 0, refs: [], reason: "UNKNOWN_COST" as const };
    if (u.reason === "NO_CURRENCY_BASIS") row.reason = "NO_CURRENCY_BASIS";
    row.documents++;
    if (u.ref && row.refs.length < 3 && !row.refs.includes(u.ref)) row.refs.push(u.ref);
    unavailable.set(u.productId, row);
  }
  const issueList: PlIssueRow[] = [...issues.map((i) => ({ productId: i.productId, day: i.day, ref: i.ref })), ...issueRows].map((i) => ({ code: names.get(i.productId)?.code ?? "", name: names.get(i.productId)?.name ?? "", day: i.day, ref: i.ref }));

  const complete = st.costComplete;
  const empty = st.activity.sales + st.activity.salesReturns + st.activity.adjustments + st.activity.expenses === 0;
  return {
    from: p.from,
    to: p.to,
    currency: { ...p.currency, right: p.iconRight },
    costComplete: complete,
    empty,
    lines: {
      sales: m(st.sales),
      orderDiscounts: m(st.orderDiscounts),
      salesReturns: m(st.salesReturns),
      netSales: m(st.netSales),
      cogsSales: m(st.cogsSales),
      cogsReturns: m(st.cogsReturns),
      cogs: m(st.cogs),
      grossProfit: complete ? m(st.grossProfit) : null,
      shippingIncome: m(st.shippingIncome),
      adjustmentGains: m(st.adjustmentGains),
      adjustmentLosses: m(st.adjustmentLosses),
      expenses: st.expenses.map((e) => ({ categoryId: e.categoryId, name: e.categoryName, amount: m(e.amount) })),
      totalExpenses: m(st.totalExpenses),
      netProfit: complete ? m(st.netProfit) : null,
    },
    tax: { collected: m(st.taxCollected), paid: m(st.taxPaid) },
    unavailable: [...unavailable.values()].sort((a, b) => a.code.localeCompare(b.code)),
    issues: issueList,
    baselines: ownBaselines.map((b) => ({ code: names.get(b.productId)?.code ?? "", name: names.get(b.productId)?.name ?? "", effectiveAt: b.effectiveAt.toISOString(), unitCost: b.unitCost.toFixed(2), quantity: b.quantity.toFixed(3) })).sort((a, b) => a.code.localeCompare(b.code)),
    activity: st.activity,
  };
}
