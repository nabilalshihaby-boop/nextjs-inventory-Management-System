import { db } from "@/lib/db";
import { isRealIsoDate } from "@/lib/inventory-report-core";
import { buildCashFlow, type FlowAccount, type FlowCategory, type FlowTx } from "@/lib/cash-flow-core";
import { fromUnits, toUnits } from "@/lib/transfers";

// Cash Flow — READ-ONLY data access. Nothing in this file writes. It reads the persisted Cash & Bank ledger (and the source links the
// owning modules stored with each row) and hands them to the pure engine (lib/cash-flow-core.ts). One currency at a time, never combined.

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim().slice(0, 64) : "");

export type CfQueryError = "errFrom" | "errTo" | "errDate" | "errDateOrder" | "errCurrency" | "errCurrencyRequired";
export type CfParams = { from: string; to: string; currencyId: string };
export function parseCfParams(sp: Raw): { ok: true; p: CfParams } | { ok: false; error: CfQueryError } {
  const from = one(sp.from);
  const to = one(sp.to);
  if (!from) return { ok: false, error: "errFrom" };
  if (!to) return { ok: false, error: "errTo" };
  if (!isRealIsoDate(from) || !isRealIsoDate(to)) return { ok: false, error: "errDate" };
  if (from > to) return { ok: false, error: "errDateOrder" };
  return { ok: true, p: { from, to, currencyId: one(sp.currency) } };
}

export type CfCurrency = { id: string; code: string; symbol: string; name: string };

/** Currencies with relevant Cash & Bank activity: an account (active OR inactive) with a non-zero opening balance or any ledger row. */
export async function getCashFlowCurrencies(): Promise<{ currencies: CfCurrency[]; iconRight: boolean }> {
  const [accounts, src, dst, settings] = await Promise.all([
    db.cashBankAccount.findMany({ select: { id: true, currencyId: true, openingBalance: true } }),
    db.cashBankTransaction.groupBy({ by: ["accountId"] }),
    db.cashBankTransaction.groupBy({ by: ["destinationAccountId"], where: { destinationAccountId: { not: null } } }),
    db.systemSettings.findUnique({ where: { id: 1 }, select: { currencyIconRight: true } }),
  ]);
  const used = new Set<string>([...src.map((g) => g.accountId), ...dst.flatMap((g) => (g.destinationAccountId ? [g.destinationAccountId] : []))]);
  const ids = new Set(accounts.filter((a) => used.has(a.id) || !a.openingBalance.isZero()).map((a) => a.currencyId));
  const currencies = await db.currency.findMany({ where: { id: { in: [...ids] } }, orderBy: { code: "asc" }, select: { id: true, code: true, symbol: true, name: true } });
  return { currencies, iconRight: settings?.currencyIconRight ?? false };
}

export function resolveCfCurrency(requestedId: string, active: CfCurrency[]): { ok: true; currency: CfCurrency } | { ok: false; error: "errCurrency" | "errCurrencyRequired" } {
  if (requestedId) {
    const c = active.find((x) => x.id === requestedId);
    return c ? { ok: true, currency: c } : { ok: false, error: "errCurrency" };
  }
  if (active.length === 1) return { ok: true, currency: active[0] };
  return { ok: false, error: active.length === 0 ? "errCurrency" : "errCurrencyRequired" };
}

export type CfRow = {
  id: string;
  date: string;
  reference: string;
  /** "Cash" or "Cash → Bank" for transfers. */
  account: string;
  /** The stored ledger purpose (translated by the page when it is a known purpose). */
  purpose: string | null;
  /** Free text the user wrote (manual rows only). */
  note: string | null;
  category: FlowCategory;
  internal: boolean;
  cashIn: string;
  cashOut: string;
  /** Amount of an internal movement (no effect on cash). */
  internalAmount: string;
  balance: string;
  /** Active expense the row belongs to (for a safe link), else null. */
  expenseId: string | null;
  pos: boolean;
};

export type CashFlowReport = {
  from: string;
  to: string;
  currency: CfCurrency & { right: boolean };
  opening: string;
  customerCollections: string;
  supplierPayments: string;
  operatingExpenses: string;
  expenseReversals: string;
  operatingNet: string;
  unclassifiedIn: string;
  unclassifiedOut: string;
  unclassifiedNet: string;
  hasUnclassified: boolean;
  netChange: string;
  closing: string;
  reconciled: boolean;
  internal: { count: number; transfers: string; registerIn: string; registerOut: string };
  rows: CfRow[];
  accounts: { total: number; inactive: number };
  empty: boolean;
};

const m = (v: bigint) => fromUnits(v, 2);
const dayOf = (d: Date) => d.toISOString().slice(0, 10); // MySQL DATE -> UTC midnight

export async function getCashFlow(p: CfParams & { currency: CfCurrency; iconRight: boolean }): Promise<CashFlowReport> {
  const R = p.currency.id;
  const allAccounts = await db.cashBankAccount.findMany({ select: { id: true, name: true, currencyId: true, openingBalance: true, status: true } });
  const accounts: FlowAccount[] = allAccounts.map((a) => ({ id: a.id, currencyId: a.currencyId, opening: toUnits(a.openingBalance.toFixed(2), 2) }));
  const name = new Map(allAccounts.map((a) => [a.id, a.name]));
  const mine = allAccounts.filter((a) => a.currencyId === R).map((a) => a.id);

  const rows = await db.cashBankTransaction.findMany({
    where: { OR: [{ accountId: { in: mine } }, { destinationAccountId: { in: mine } }] },
    orderBy: [{ transactionDate: "asc" }, { number: "asc" }],
    select: {
      id: true,
      number: true,
      reference: true,
      transactionDate: true,
      type: true,
      accountId: true,
      destinationAccountId: true,
      amount: true,
      purpose: true,
      notes: true,
      customerPaymentId: true,
      supplierPaymentId: true,
      expenseId: true,
      expense: { select: { id: true, deletedAt: true } },
      customerPayment: { select: { registerSessionId: true } },
      registerMovement: { select: { type: true } },
    },
  });
  const txs: FlowTx[] = rows.map((r) => ({
    id: r.id,
    number: r.number,
    date: dayOf(r.transactionDate),
    reference: r.reference,
    type: r.type,
    accountId: r.accountId,
    destinationAccountId: r.destinationAccountId,
    amount: toUnits(r.amount.toFixed(2), 2),
    purpose: r.purpose,
    notes: r.notes,
    customerPaymentId: r.customerPaymentId,
    supplierPaymentId: r.supplierPaymentId,
    expenseId: r.expenseId,
    registerMovement: r.registerMovement?.type ?? null,
  }));
  const extra = new Map(rows.map((r) => [r.id, { expenseId: r.expense && !r.expense.deletedAt ? r.expense.id : null, pos: !!r.customerPayment?.registerSessionId }]));

  const s = buildCashFlow({ from: p.from, to: p.to, currencyId: R, accounts, txs });
  const unclassified = s.unclassifiedIn !== BigInt(0) || s.unclassifiedOut !== BigInt(0);
  return {
    from: p.from,
    to: p.to,
    currency: { ...p.currency, right: p.iconRight },
    opening: m(s.opening),
    customerCollections: m(s.customerCollections),
    supplierPayments: m(s.supplierPayments),
    operatingExpenses: m(s.operatingExpenses),
    expenseReversals: m(s.expenseReversals),
    operatingNet: m(s.operatingNet),
    unclassifiedIn: m(s.unclassifiedIn),
    unclassifiedOut: m(s.unclassifiedOut),
    unclassifiedNet: m(s.unclassifiedNet),
    hasUnclassified: unclassified,
    netChange: m(s.netChange),
    closing: m(s.closing),
    reconciled: s.reconciled,
    internal: { count: s.internal.count, transfers: m(s.internal.transfers), registerIn: m(s.internal.registerIn), registerOut: m(s.internal.registerOut) },
    rows: s.rows.map((r) => {
      const x = extra.get(r.tx.id);
      const transfer = r.tx.type === "TRANSFER";
      return {
        id: r.tx.id,
        date: r.tx.date,
        reference: r.tx.reference,
        account: transfer ? `${name.get(r.tx.accountId) ?? ""} → ${name.get(r.tx.destinationAccountId ?? "") ?? ""}` : (name.get(r.tx.accountId) ?? ""),
        purpose: r.tx.purpose,
        note: !r.internal && (r.category === "UNCLASSIFIED_IN" || r.category === "UNCLASSIFIED_OUT") ? (r.tx.notes ? r.tx.notes.slice(0, 160) : null) : null,
        category: r.category,
        internal: r.internal,
        cashIn: r.effect > BigInt(0) ? m(r.effect) : "",
        cashOut: r.effect < BigInt(0) ? m(-r.effect) : "",
        internalAmount: r.internal ? m(r.tx.amount) : "",
        balance: m(r.balance),
        expenseId: x?.expenseId ?? null,
        pos: x?.pos ?? false,
      };
    }),
    accounts: { total: mine.length, inactive: allAccounts.filter((a) => a.currencyId === R && a.status === "INACTIVE").length },
    empty: s.rows.length === 0,
  };
}
