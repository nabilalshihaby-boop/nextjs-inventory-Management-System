// Dashboard data layer (server-only, READ-ONLY: nothing here writes). Every loader runs only for a section the user's plan allows
// (lib/dashboard-core.ts), and every warehouse-bound query is limited to the user's assigned warehouses IN THE QUERY (never after the
// fact). Money is never added across currencies: each figure is a list of per-currency amounts.
//
// Metric definitions (also reported to the reviewer):
//  - Net Sales        = Σ grandTotal of COMPLETED sales dated in the period − Σ grandTotal of COMPLETED sale returns dated in the period
//                       (each by its OWN business date, per its own currency; never clamped, so it can be negative).
//  - Net Purchases    = Σ grandTotal of RECEIVED purchases dated in the period − Σ grandTotal of COMPLETED purchase returns dated in the period (same rules).
//  - Expenses         = Σ amount of non-deleted expenses dated in the period, per the currency of their cash/bank account.
//  - Cash & bank      = ACTIVE accounts' ledger balances (computeBalances, the Finance page's own helper), summed per currency.
//  - Receivables/Pay. = the Aging report's own outstanding totals as of today (getAging), one currency at a time.
//  - Low stock        = getLowStock() (the Low Stock report's own rule), already limited to the user's warehouses.
//  - Pending work     = sales PENDING, purchases PENDING/ORDERED, transfers PENDING/SENT (documents that still need action).
//  - Register         = OPEN register sessions with expected cash = opening + cash sales + cash in − cash out (register-data helpers).
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { todayLocal } from "@/lib/cash-bank";
import { computeBalances } from "@/lib/cash-bank-server";
import { getAging, getAgingCurrencies } from "@/lib/aging";
import { getLowStock, type LowRow } from "@/lib/inventory-reports";
import { expectedOf, totalsBySession } from "@/lib/register-data";
import { formatDateOnly } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { transferFilter, warehouseIdFilter } from "@/lib/access-scope";
import { pendingParts, type DashboardPlan, type DashUser } from "@/lib/dashboard-core";

const dateOnly = (v: string) => new Date(`${v}T00:00:00.000Z`);
const D0 = new Prisma.Decimal(0);

export type MoneyLine = { code: string; text: string };
export type Period = { today: MoneyLine[]; month: MoneyLine[]; todayCount: number; monthCount: number; /** Returns dated in the period (per currency, only non-zero); sales/purchases KPIs are NET of these. */ todayReturns?: MoneyLine[]; monthReturns?: MoneyLine[] };
export type BalanceLine = MoneyLine & { accounts: number };
export type RecentSale = { id: string; reference: string; customer: string; date: string; status: "COMPLETED" | "PENDING"; total: string };
export type OpenRegister = { id: string; reference: string; account: string; expected: string; opening: string; mine: boolean; openedBy: string | null };
export type DashboardData = {
  today: string;
  sales?: Period;
  purchases?: Period;
  expenses?: Period;
  balances?: { lines: BalanceLine[]; accounts: number };
  receivables?: MoneyLine[]; // outstanding, per currency (only non-zero)
  payables?: MoneyLine[];
  agingCurrencies?: number;
  lowStock?: { items: number; out: number; rows: LowRow[] };
  pending?: { transfers?: number; sales?: number; purchases?: number };
  registers?: OpenRegister[];
  recentSales?: RecentSale[];
};

type CurrencyInfo = { code: string; symbol: string };

/** Sum per currency → display lines, sorted by code; zero totals are left out (no fabricated figures). */
function lines(by: Map<string, Prisma.Decimal>, cur: Map<string, CurrencyInfo>, right: boolean, keep?: (id: string) => boolean): MoneyLine[] {
  return [...by.entries()]
    .filter(([id, v]) => cur.has(id) && (keep ? keep(id) : !v.isZero()))
    .map(([id, v]) => ({ code: cur.get(id)!.code, text: formatMoney(v.toFixed(2), { ...cur.get(id)!, right }) }))
    .sort((a, b) => a.code.localeCompare(b.code));
}
const addTo = (m: Map<string, Prisma.Decimal>, k: string, v: Prisma.Decimal) => m.set(k, (m.get(k) ?? D0).plus(v));

export async function loadDashboard(user: DashUser, plan: DashboardPlan): Promise<DashboardData> {
  const today = todayLocal();
  const monthStart = `${today.slice(0, 8)}01`;
  const data: DashboardData = { today };
  if (!plan.figures || plan.sections.size === 0) return data;

  const [currencies, settings] = await Promise.all([db.currency.findMany({ select: { id: true, code: true, symbol: true } }), db.systemSettings.findUnique({ where: { id: 1 }, select: { currencyIconRight: true, dateFormat: true } })]);
  const cur = new Map(currencies.map((c) => [c.id, { code: c.code, symbol: c.symbol }]));
  const right = settings?.currencyIconRight ?? false;
  const has = (k: Parameters<typeof plan.sections.has>[0]) => plan.sections.has(k);
  const wh = await warehouseIdFilter(); // {} for OWNER/ADMIN, otherwise { warehouseId: { in: scope } } — applied inside every query below
  const d = { today: dateOnly(today), month: dateOnly(monthStart) };

  const period = async (kind: "sale" | "purchase"): Promise<Period> => {
    const dateField = kind === "sale" ? "saleDate" : "purchaseDate";
    const run = async (from: Date) => {
      const where = { ...wh, status: kind === "sale" ? ("COMPLETED" as const) : ("RECEIVED" as const), [dateField]: { gte: from, lte: d.today } };
      // Returns use the same status rule as the Aging report (COMPLETED) and are counted by their OWN returnDate and currency.
      const rWhere = { ...wh, status: "COMPLETED" as const, returnDate: { gte: from, lte: d.today } };
      const [g, rg] = await Promise.all([
        kind === "sale"
          ? db.sale.groupBy({ by: ["currencyId"], where: where as Prisma.SaleWhereInput, _sum: { grandTotal: true }, _count: { _all: true } })
          : db.purchase.groupBy({ by: ["currencyId"], where: where as Prisma.PurchaseWhereInput, _sum: { grandTotal: true }, _count: { _all: true } }),
        kind === "sale"
          ? db.saleReturn.groupBy({ by: ["currencyId"], where: rWhere as Prisma.SaleReturnWhereInput, _sum: { grandTotal: true } })
          : db.purchaseReturn.groupBy({ by: ["currencyId"], where: rWhere as Prisma.PurchaseReturnWhereInput, _sum: { grandTotal: true } }),
      ]);
      const gross = new Map<string, Prisma.Decimal>(), ret = new Map<string, Prisma.Decimal>();
      let n = 0;
      for (const r of g) { addTo(gross, r.currencyId, r._sum.grandTotal ?? D0); n += r._count._all; }
      for (const r of rg) addTo(ret, r.currencyId, r._sum.grandTotal ?? D0);
      // Net per currency, never clamped (a period with more returns than sales is negative). A currency is listed when it had any sale
      // or any return in the period, so a net of exactly 0.00 caused by returns is still shown.
      const net = new Map<string, Prisma.Decimal>();
      for (const id of new Set([...gross.keys(), ...ret.keys()])) net.set(id, (gross.get(id) ?? D0).minus(ret.get(id) ?? D0));
      return { lines: lines(net, cur, right, (id) => (gross.get(id) ?? D0).gt(0) || (ret.get(id) ?? D0).gt(0)), returns: lines(ret, cur, right), count: n };
    };
    const [t, mo] = await Promise.all([run(d.today), run(d.month)]);
    return { today: t.lines, month: mo.lines, todayCount: t.count, monthCount: mo.count, todayReturns: t.returns, monthReturns: mo.returns };
  };

  const tasks: Promise<void>[] = [];
  if (has("sales")) tasks.push(period("sale").then((p) => void (data.sales = p)));
  if (has("purchases")) tasks.push(period("purchase").then((p) => void (data.purchases = p)));

  if (has("expenses")) {
    tasks.push(
      (async () => {
        // Expenses carry a warehouse but expenses.manage is not a warehouse-scoped permission: an unrestricted user (and a USER with no assigned
        // warehouses, e.g. an accountant) sees them all, while a warehouse-limited user only receives their own warehouses' expenses.
        const run = async (from: Date) => {
          const g = await db.expense.groupBy({ by: ["cashBankAccountId"], where: { ...(plan.limited ? wh : {}), deletedAt: null, expenseDate: { gte: from, lte: d.today } }, _sum: { amount: true }, _count: { _all: true } });
          const accs = await db.cashBankAccount.findMany({ where: { id: { in: g.map((x) => x.cashBankAccountId) } }, select: { id: true, currencyId: true } });
          const curOf = new Map(accs.map((a) => [a.id, a.currencyId]));
          const m = new Map<string, Prisma.Decimal>();
          let n = 0;
          for (const r of g) { const c = curOf.get(r.cashBankAccountId); if (c) addTo(m, c, r._sum.amount ?? D0); n += r._count._all; }
          return { lines: lines(m, cur, right), count: n };
        };
        const [t, mo] = await Promise.all([run(d.today), run(d.month)]);
        data.expenses = { today: t.lines, month: mo.lines, todayCount: t.count, monthCount: mo.count };
      })(),
    );
  }

  if (has("balances")) {
    tasks.push(
      (async () => {
        const accounts = await db.cashBankAccount.findMany({ where: { status: "ACTIVE" }, select: { id: true, currencyId: true } });
        const bal = await computeBalances(db, accounts.map((a) => a.id));
        const m = new Map<string, Prisma.Decimal>();
        const count = new Map<string, number>();
        for (const a of accounts) { addTo(m, a.currencyId, bal.get(a.id) ?? D0); count.set(a.currencyId, (count.get(a.currencyId) ?? 0) + 1); }
        // A zero total is a real balance here (an active account exists), so it is kept.
        const out: BalanceLine[] = [...m.entries()].filter(([id]) => cur.has(id)).map(([id, v]) => ({ code: cur.get(id)!.code, text: formatMoney(v.toFixed(2), { ...cur.get(id)!, right }), accounts: count.get(id) ?? 0 })).sort((a, b) => a.code.localeCompare(b.code));
        data.balances = { lines: out, accounts: accounts.length };
      })(),
    );
  }

  if (has("receivables") || has("payables")) {
    tasks.push(
      (async () => {
        const wantAP = has("payables"), wantAR = has("receivables");
        const type = wantAR && wantAP ? "both" : wantAR ? "receivables" : "payables";
        const { currencies: active, iconRight } = await getAgingCurrencies(type);
        const ar: MoneyLine[] = [], ap: MoneyLine[] = [];
        for (const c of active) {
          const r = await getAging({ type, asOf: today, currencyId: c.id, customerId: "", supplierId: "", currency: c, iconRight, customer: null, supplier: null });
          const fm = (v: string): MoneyLine => ({ code: c.code, text: formatMoney(v, { code: c.code, symbol: c.symbol, right: iconRight }) });
          if (r.receivables && !/^-?0+(\.0+)?$/.test(r.receivables.totals.outstanding)) ar.push(fm(r.receivables.totals.outstanding));
          if (r.payables && !/^-?0+(\.0+)?$/.test(r.payables.totals.outstanding)) ap.push(fm(r.payables.totals.outstanding));
        }
        data.agingCurrencies = active.length;
        if (wantAR) data.receivables = ar;
        if (wantAP) data.payables = ap;
      })(),
    );
  }

  if (has("lowStock")) {
    tasks.push(
      getLowStock({ warehouseId: "", categoryId: "", brandId: "" }).then((r) => {
        data.lowStock = r ? { items: r.totals.items, out: r.totals.out, rows: r.rows.slice(0, 6) } : { items: 0, out: 0, rows: [] };
      }),
    );
  }

  if (has("pendingWork")) {
    tasks.push(
      (async () => {
        const parts = pendingParts(user);
        const tf = await transferFilter();
        const [transfers, sales, purchases] = await Promise.all([
          parts.transfers ? db.stockTransfer.count({ where: { ...tf, status: { in: ["PENDING", "SENT"] } } }) : undefined,
          parts.sales ? db.sale.count({ where: { ...wh, status: "PENDING" } }) : undefined,
          parts.purchases ? db.purchase.count({ where: { ...wh, status: { in: ["PENDING", "ORDERED"] } } }) : undefined,
        ]);
        data.pending = { transfers, sales, purchases };
      })(),
    );
  }

  if (has("register")) {
    tasks.push(
      (async () => {
        // OWNER/ADMIN see every open register; a USER sees only the register THEY opened (openedById is stored on every session).
        const admin = user.role === "OWNER" || user.role === "ADMIN";
        const sessions = await db.cashRegisterSession.findMany({
          where: { status: "OPEN", ...(admin ? {} : { openedById: user.id ?? "" }) },
          orderBy: { number: "desc" },
          take: 20,
          select: { id: true, reference: true, openingCash: true, openedById: true, openedByName: true, cashBankAccount: { select: { name: true, currency: true } } },
        });
        const totals = await totalsBySession(sessions.map((s) => s.id));
        const openers = admin ? await db.user.findMany({ where: { id: { in: sessions.map((s) => s.openedById) } }, select: { id: true, firstName: true, lastName: true } }) : [];
        const nameOf = new Map(openers.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
        data.registers = sessions.map((s) => {
          const c = s.cashBankAccount.currency;
          const f = (v: Prisma.Decimal) => formatMoney(v.toFixed(2), { code: c.code, symbol: c.symbol, right });
          return { id: s.id, reference: s.reference, account: s.cashBankAccount.name, opening: f(s.openingCash), expected: f(expectedOf(s.openingCash, totals.get(s.id)!)), mine: s.openedById === user.id, openedBy: admin ? (s.openedByName ?? nameOf.get(s.openedById) ?? null) : null };
        });
      })(),
    );
  }

  if (has("recentSales")) {
    tasks.push(
      (async () => {
        const rows = await db.sale.findMany({
          where: { ...wh },
          orderBy: [{ createdAt: "desc" }, { number: "desc" }],
          take: 5,
          select: { id: true, reference: true, status: true, saleDate: true, grandTotal: true, currencyId: true, customer: { select: { name: true } } },
        });
        data.recentSales = rows.map((r) => ({ id: r.id, reference: r.reference, customer: r.customer.name, date: formatDateOnly(r.saleDate, settings?.dateFormat), status: r.status, total: formatMoney(r.grandTotal.toFixed(2), cur.has(r.currencyId) ? { ...cur.get(r.currencyId)!, right } : null) }));
      })(),
    );
  }

  await Promise.all(tasks);
  return data;
}
