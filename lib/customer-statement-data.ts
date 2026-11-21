// Server-only loader for the Customer Account Statement (OWNER/ADMIN — callers check the role).
// Reads real Sales (COMPLETED only), Sales Returns and Customer Payments; nothing is written.
import { db } from "@/lib/db";
import { formatDateOnly } from "@/lib/format";
import { getDefaultCurrency, getSystemSettings } from "@/lib/settings";
import { fromUnits, toUnits } from "@/lib/transfers";
import { fmt as fmtMsg } from "@/lib/i18n/config";
import { tr } from "@/lib/i18n/messages";
import type { Dictionary } from "@/lib/i18n";
import { statementRangeKey, type CustomerStatement, type CustomerStatementKind, type CustomerStatementRow, type StatementCurrency } from "@/lib/customer-statement";

const KIND_ORDER: Record<CustomerStatementKind, number> = { SALE: 0, RETURN: 1, PAYMENT: 2 };
type Entry = { key: string; date: Date; at: number; kind: CustomerStatementKind; reference: string; href: string; description: string; currencyId: string; debit: bigint; credit: bigint };

const cents = (v: { toFixed: (n: number) => string }) => toUnits(v.toFixed(2), 2);
const money = (u: bigint) => (u < BigInt(0) ? "-" + fromUnits(-u, 2) : fromUnits(u, 2));
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Every ledger entry of one customer (all currencies), in chronological order. */
async function customerEntries(customerId: string, t: Dictionary): Promise<{ entries: Entry[]; currencies: Map<string, { id: string; code: string; symbol: string }> }> {
  const [sales, returns, payments] = await Promise.all([
    db.sale.findMany({
      where: { customerId, status: "COMPLETED" },
      select: { id: true, reference: true, saleDate: true, createdAt: true, grandTotal: true, currencyId: true, currency: { select: { id: true, code: true, symbol: true } }, warehouse: { select: { name: true } } },
    }),
    db.saleReturn.findMany({
      where: { customerId, status: "COMPLETED" },
      select: { id: true, reference: true, returnDate: true, createdAt: true, grandTotal: true, currencyId: true, currency: { select: { id: true, code: true, symbol: true } }, sale: { select: { reference: true } }, warehouse: { select: { name: true } } },
    }),
    db.customerPayment.findMany({
      where: { customerId },
      select: {
        id: true, reference: true, paymentDate: true, createdAt: true, amount: true, paymentMethod: true, externalReference: true, currencyId: true,
        currency: { select: { id: true, code: true, symbol: true } },
        cashBankAccount: { select: { name: true } },
        allocations: { orderBy: { sale: { number: "asc" } }, select: { sale: { select: { reference: true } } } },
      },
    }),
  ]);
  const currencies = new Map<string, { id: string; code: string; symbol: string }>();
  const entries: Entry[] = [];
  for (const s of sales) {
    currencies.set(s.currencyId, s.currency);
    entries.push({ key: `s-${s.id}`, date: s.saleDate, at: s.createdAt.getTime(), kind: "SALE", reference: s.reference, href: `/sales/${encodeURIComponent(s.id)}`, description: fmtMsg(t.stmt.descSale, { warehouse: s.warehouse.name }), currencyId: s.currencyId, debit: cents(s.grandTotal), credit: BigInt(0) });
  }
  for (const r of returns) {
    currencies.set(r.currencyId, r.currency);
    entries.push({ key: `r-${r.id}`, date: r.returnDate, at: r.createdAt.getTime(), kind: "RETURN", reference: r.reference, href: `/sales/returns/${encodeURIComponent(r.id)}`, description: fmtMsg(t.stmt.descReturn, { sale: r.sale.reference, warehouse: r.warehouse.name }), currencyId: r.currencyId, debit: BigInt(0), credit: cents(r.grandTotal) });
  }
  for (const p of payments) {
    currencies.set(p.currencyId, p.currency);
    const applied = p.allocations.map((a) => a.sale.reference).join(", ");
    entries.push({
      key: `p-${p.id}`, date: p.paymentDate, at: p.createdAt.getTime(), kind: "PAYMENT", reference: p.reference, href: `/customer-payments?q=${encodeURIComponent(p.reference)}`,
      description: fmtMsg(p.externalReference ? t.stmt.descPaymentExt : t.stmt.descPayment, { method: (t.sales.methods as Record<string, string>)[p.paymentMethod] ?? p.paymentMethod, account: p.cashBankAccount.name, sales: applied, ref: p.externalReference ?? "" }),
      currencyId: p.currencyId, debit: BigInt(0), credit: cents(p.amount),
    });
  }
  entries.sort((a, b) => a.date.getTime() - b.date.getTime() || a.at - b.at || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.reference.localeCompare(b.reference));
  return { entries, currencies };
}

export type CustomerStatementQuery = { customer?: string; from?: string; to?: string; currency?: string };
export type CustomerStatementData = { statement: CustomerStatement; customers: { id: string; name: string }[]; notice: string | null };

/**
 * The statement for the requested customer / period / currency. Invalid or missing dates/currency
 * fall back to defaults (the customer's first record … today, default currency) and are reported in
 * `notice`. With no (or an unknown) customer nothing is loaded: `statement.customer` is null.
 * Returns null when there are no customers at all.
 */
export async function getCustomerStatement(q: CustomerStatementQuery, today: string, t: Dictionary): Promise<CustomerStatementData | null> {
  const customers = await db.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  if (!customers.length) return null;
  const notices: string[] = [];
  const settings = await getSystemSettings();
  const fmt = (d: string) => formatDateOnly(new Date(`${d}T00:00:00.000Z`), settings?.dateFormat);
  const customer = customers.find((c) => c.id === q.customer) ?? null;
  if (!customer) {
    if (q.customer) notices.push(t.stmt.noticeCustomerNotFound);
    return {
      customers,
      notice: notices.join(" ") || null,
      statement: { customer: null, from: "", to: "", fromLabel: "", toLabel: "", currency: null, currencies: [], opening: "0.00", totalSales: "0.00", totalReturns: "0.00", totalPaid: "0.00", closing: "0.00", rows: [] },
    };
  }
  const [{ entries, currencies }, def] = await Promise.all([customerEntries(customer.id, t), getDefaultCurrency()]);
  const right = !!settings?.currencyIconRight;

  const first = entries.length ? iso(entries[0].date) : today;
  let from = q.from ?? "", to = q.to ?? "";
  if (from || to) {
    const errKey = statementRangeKey(from, to);
    if (errKey) {
      notices.push(fmtMsg(t.stmt.noticeFallback, { error: tr(t, errKey) }));
      from = "";
      to = "";
    }
  }
  if (!from) from = first < today ? first : today;
  if (!to) to = today > from ? today : from;

  const list: StatementCurrency[] = [...currencies.values()].map((c) => ({ ...c, right })).sort((a, b) => a.code.localeCompare(b.code));
  let currency = list.find((c) => c.id === q.currency) ?? null;
  if (!currency && q.currency) notices.push(t.stmt.noticeCurrency);
  currency ??= list.find((c) => c.id === def?.id) ?? list[0] ?? (def ? { id: def.id, code: def.code, symbol: def.symbol, right } : null);

  let opening = BigInt(0), sales = BigInt(0), returns = BigInt(0), paid = BigInt(0);
  const rows: CustomerStatementRow[] = [];
  let balance = BigInt(0);
  for (const e of entries) {
    if (!currency || e.currencyId !== currency.id) continue;
    const d = iso(e.date);
    if (d > to) break; // sorted by date
    balance += e.debit - e.credit;
    if (d < from) {
      opening = balance;
      continue;
    }
    if (e.kind === "SALE") sales += e.debit;
    else if (e.kind === "RETURN") returns += e.credit;
    else paid += e.credit;
    rows.push({ key: e.key, date: d, dateLabel: formatDateOnly(e.date, settings?.dateFormat), kind: e.kind, reference: e.reference, href: e.href, description: e.description, debit: e.debit ? money(e.debit) : null, credit: e.credit ? money(e.credit) : null, balance: money(balance) });
  }
  return {
    customers,
    notice: notices.length ? notices.join(" ") : null,
    statement: { customer, from, to, fromLabel: fmt(from), toLabel: fmt(to), currency, currencies: list, opening: money(opening), totalSales: money(sales), totalReturns: money(returns), totalPaid: money(paid), closing: money(opening + sales - returns - paid), rows },
  };
}
