// Server-only loader for the Supplier Account Statement (OWNER/ADMIN — callers check the role).
// Reads real Purchases, Purchase Returns and Supplier Payments only; nothing is written.
import { db } from "@/lib/db";
import { formatDateOnly } from "@/lib/format";
import { PURCHASE_STATUS_LABEL } from "@/lib/purchases";
import { getDefaultCurrency, getSystemSettings } from "@/lib/settings";
import { fromUnits, toUnits } from "@/lib/transfers";
import { statementRangeError, type StatementCurrency, type StatementKind, type StatementRow, type SupplierStatement } from "@/lib/supplier-statement";

const KIND_ORDER: Record<StatementKind, number> = { PURCHASE: 0, RETURN: 1, PAYMENT: 2 };
type Entry = { key: string; date: Date; at: number; kind: StatementKind; reference: string; href: string; description: string; currencyId: string; debit: bigint; credit: bigint };

const cents = (v: { toFixed: (n: number) => string }) => toUnits(v.toFixed(2), 2);
const money = (u: bigint) => (u < BigInt(0) ? "-" + fromUnits(-u, 2) : fromUnits(u, 2));
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Every ledger entry of one supplier (all currencies), in chronological order. */
async function supplierEntries(supplierId: string): Promise<{ entries: Entry[]; currencies: Map<string, { id: string; code: string; symbol: string }> }> {
  const [purchases, returns, payments] = await Promise.all([
    db.purchase.findMany({
      where: { supplierId },
      select: { id: true, reference: true, purchaseDate: true, createdAt: true, status: true, grandTotal: true, currencyId: true, currency: { select: { id: true, code: true, symbol: true } }, warehouse: { select: { name: true } } },
    }),
    db.purchaseReturn.findMany({
      where: { supplierId },
      select: { id: true, reference: true, returnDate: true, createdAt: true, grandTotal: true, currencyId: true, currency: { select: { id: true, code: true, symbol: true } }, purchase: { select: { reference: true } }, warehouse: { select: { name: true } } },
    }),
    db.supplierPayment.findMany({
      where: { supplierId },
      select: {
        id: true, reference: true, paymentDate: true, createdAt: true, amount: true, paymentMethod: true, externalReference: true, currencyId: true,
        currency: { select: { id: true, code: true, symbol: true } },
        cashBankAccount: { select: { name: true } },
        allocations: { orderBy: { purchase: { number: "asc" } }, select: { purchase: { select: { reference: true } } } },
      },
    }),
  ]);
  const currencies = new Map<string, { id: string; code: string; symbol: string }>();
  const entries: Entry[] = [];
  for (const p of purchases) {
    currencies.set(p.currencyId, p.currency);
    entries.push({ key: `p-${p.id}`, date: p.purchaseDate, at: p.createdAt.getTime(), kind: "PURCHASE", reference: p.reference, href: `/purchases/${encodeURIComponent(p.id)}`, description: `Purchase — ${p.warehouse.name} (${PURCHASE_STATUS_LABEL[p.status]})`, currencyId: p.currencyId, debit: BigInt(0), credit: cents(p.grandTotal) });
  }
  for (const r of returns) {
    currencies.set(r.currencyId, r.currency);
    entries.push({ key: `r-${r.id}`, date: r.returnDate, at: r.createdAt.getTime(), kind: "RETURN", reference: r.reference, href: `/purchases/returns/${encodeURIComponent(r.id)}`, description: `Return of ${r.purchase.reference} — ${r.warehouse.name}`, currencyId: r.currencyId, debit: cents(r.grandTotal), credit: BigInt(0) });
  }
  for (const s of payments) {
    currencies.set(s.currencyId, s.currency);
    const applied = s.allocations.map((a) => a.purchase.reference).join(", ");
    entries.push({
      key: `s-${s.id}`, date: s.paymentDate, at: s.createdAt.getTime(), kind: "PAYMENT", reference: s.reference, href: `/supplier-payments?q=${encodeURIComponent(s.reference)}`,
      description: `${s.paymentMethod} payment from ${s.cashBankAccount.name} — applied to ${applied}${s.externalReference ? ` (Ref ${s.externalReference})` : ""}`,
      currencyId: s.currencyId, debit: cents(s.amount), credit: BigInt(0),
    });
  }
  entries.sort((a, b) => a.date.getTime() - b.date.getTime() || a.at - b.at || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.reference.localeCompare(b.reference));
  return { entries, currencies };
}

export type StatementQuery = { supplier?: string; from?: string; to?: string; currency?: string };

/**
 * The statement for the requested supplier / period / currency. Invalid or missing parameters fall
 * back to defaults (first supplier, its first record date … today, default currency) and are
 * reported in `notice`. Returns null when there are no suppliers at all.
 */
export async function getSupplierStatement(q: StatementQuery, today: string): Promise<{ statement: SupplierStatement; suppliers: { id: string; name: string }[]; notice: string | null } | null> {
  const suppliers = await db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  if (!suppliers.length) return null;
  const notices: string[] = [];
  let supplier = suppliers.find((s) => s.id === q.supplier);
  if (!supplier) {
    if (q.supplier) notices.push("That supplier wasn't found — showing the first supplier instead.");
    supplier = suppliers[0];
  }
  const [{ entries, currencies }, settings, def] = await Promise.all([supplierEntries(supplier.id), getSystemSettings(), getDefaultCurrency()]);
  const right = !!settings?.currencyIconRight;

  // Period: defaults to the supplier's whole history up to today.
  const first = entries.length ? iso(entries[0].date) : today;
  let from = q.from ?? "", to = q.to ?? "";
  if (from || to) {
    const err = statementRangeError(from, to);
    if (err) {
      notices.push(`${err} — showing the full history instead.`);
      from = "";
      to = "";
    }
  }
  if (!from) from = first < today ? first : today;
  if (!to) to = today > from ? today : from;

  // Currency: requested → default currency → the first one the supplier uses.
  const list: StatementCurrency[] = [...currencies.values()].map((c) => ({ ...c, right })).sort((a, b) => a.code.localeCompare(b.code));
  let currency = list.find((c) => c.id === q.currency) ?? null;
  if (!currency && q.currency) notices.push("That currency has no records for this supplier.");
  currency ??= list.find((c) => c.id === def?.id) ?? list[0] ?? (def ? { id: def.id, code: def.code, symbol: def.symbol, right } : null);

  let opening = BigInt(0), purchases = BigInt(0), returns = BigInt(0), paid = BigInt(0);
  const rows: StatementRow[] = [];
  let balance = BigInt(0);
  for (const e of entries) {
    if (!currency || e.currencyId !== currency.id) continue;
    const d = iso(e.date);
    if (d > to) break; // sorted by date
    balance += e.credit - e.debit;
    if (d < from) {
      opening = balance;
      continue;
    }
    if (e.kind === "PURCHASE") purchases += e.credit;
    else if (e.kind === "RETURN") returns += e.debit;
    else paid += e.debit;
    rows.push({ key: e.key, date: d, dateLabel: formatDateOnly(e.date, settings?.dateFormat), kind: e.kind, reference: e.reference, href: e.href, description: e.description, debit: e.debit ? money(e.debit) : null, credit: e.credit ? money(e.credit) : null, balance: money(balance) });
  }
  return {
    suppliers,
    notice: notices.length ? notices.join(" ") : null,
    statement: {
      supplier,
      from,
      to,
      fromLabel: formatDateOnly(new Date(`${from}T00:00:00.000Z`), settings?.dateFormat),
      toLabel: formatDateOnly(new Date(`${to}T00:00:00.000Z`), settings?.dateFormat),
      currency,
      currencies: list,
      opening: money(opening),
      totalPurchases: money(purchases),
      totalReturns: money(returns),
      totalPaid: money(paid),
      closing: money(opening + purchases - returns - paid),
      rows,
    },
  };
}
