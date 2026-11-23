import { z } from "zod";
import { db } from "@/lib/db";
import { todayLocal } from "@/lib/cash-bank";
import { isRealIsoDate } from "@/lib/inventory-report-core";
import { buildAging, type AgingSection, type Amounts, type Bucket } from "@/lib/aging-core";
import { fromUnits, toUnits } from "@/lib/transfers";

// Receivables & Payables Aging — READ-ONLY data access (nothing here writes). Documents come from the persisted Sales / Purchases,
// their completed returns and their payment ALLOCATIONS (never a payment's total), each filtered to the As of Date.
// Receivables = COMPLETED Sales only (the Customer Statement / Customer Payments rule). Payables = every Purchase (Received, Pending or
// Ordered), exactly like the Supplier Statement and Supplier Payments, because that is how the application treats a supplier liability.

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim() : "");

export type AgingType = "receivables" | "payables" | "both";
export type AgingQueryError = "errType" | "errAsOfRequired" | "errAsOfInvalid" | "errAsOfFuture" | "errCurrency" | "errCurrencyRequired" | "errCustomer" | "errSupplier" | "errBadParams";
export type AgingParams = { type: AgingType; asOf: string; currencyId: string; customerId: string; supplierId: string };

// Every parameter is validated here on the server (the client form is only a convenience). Anything unexpected is rejected, never "fixed".
const idShape = z.string().trim().max(64);
const paramShape = z.object({ type: z.enum(["receivables", "payables", "both"]), asOf: z.string().trim().max(10), currency: idShape.default(""), customer: idShape.default(""), supplier: idShape.default("") });

export function parseAgingParams(sp: Raw): { ok: true; p: AgingParams } | { ok: false; error: AgingQueryError } {
  const typeRaw = first(sp.type);
  if (!["receivables", "payables", "both"].includes(typeRaw)) return { ok: false, error: "errType" };
  const asOf = first(sp.asOf);
  if (!asOf) return { ok: false, error: "errAsOfRequired" };
  if (!isRealIsoDate(asOf)) return { ok: false, error: "errAsOfInvalid" };
  if (asOf > todayLocal()) return { ok: false, error: "errAsOfFuture" };
  const parsed = paramShape.safeParse({ type: typeRaw, asOf, currency: first(sp.currency), customer: first(sp.customer), supplier: first(sp.supplier) });
  if (!parsed.success) return { ok: false, error: "errBadParams" };
  const d = parsed.data;
  return { ok: true, p: { type: d.type, asOf: d.asOf, currencyId: d.currency, customerId: d.customer, supplierId: d.supplier } };
}

export type AgingCurrency = { id: string; code: string; symbol: string; name: string };
const wantsAR = (t: AgingType) => t !== "payables";
const wantsAP = (t: AgingType) => t !== "receivables";

/** Currencies that have relevant documents for the selected report type (completed sales and/or any purchase). */
export async function getAgingCurrencies(type: AgingType): Promise<{ currencies: AgingCurrency[]; iconRight: boolean }> {
  const [s, p, settings] = await Promise.all([
    wantsAR(type) ? db.sale.groupBy({ by: ["currencyId"], where: { status: "COMPLETED" } }) : Promise.resolve([]),
    wantsAP(type) ? db.purchase.groupBy({ by: ["currencyId"] }) : Promise.resolve([]),
    db.systemSettings.findUnique({ where: { id: 1 }, select: { currencyIconRight: true } }),
  ]);
  const ids = [...new Set([...s, ...p].map((g) => g.currencyId))];
  const currencies = await db.currency.findMany({ where: { id: { in: ids } }, orderBy: { code: "asc" }, select: { id: true, code: true, symbol: true, name: true } });
  return { currencies, iconRight: settings?.currencyIconRight ?? false };
}

export function resolveAgingCurrency(requestedId: string, active: AgingCurrency[]): { ok: true; currency: AgingCurrency } | { ok: false; error: "errCurrency" | "errCurrencyRequired" } {
  if (requestedId) {
    const c = active.find((x) => x.id === requestedId);
    return c ? { ok: true, currency: c } : { ok: false, error: "errCurrency" };
  }
  if (active.length === 1) return { ok: true, currency: active[0] };
  // Several currencies are relevant: they are never combined, so exactly one must be chosen.
  return { ok: false, error: active.length === 0 ? "errCurrency" : "errCurrencyRequired" };
}

export type AmountsView = { total: string; returns: string; payments: string; outstanding: string; buckets: Record<Bucket, string> };
export type RowView = { id: string; reference: string; date: string; days: number; bucket: Bucket; status: string | null; total: string; returns: string; payments: string; outstanding: string };
export type GroupView = { partyId: string; partyName: string; rows: RowView[]; sub: AmountsView };
export type SectionView = { groups: GroupView[]; totals: AmountsView; reconciled: boolean; documents: number };
export type AgingReport = {
  type: AgingType;
  asOf: string;
  currency: AgingCurrency & { right: boolean };
  customer: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  receivables: SectionView | null;
  payables: SectionView | null;
};

const m = (v: bigint) => fromUnits(v, 2);
const amountsView = (a: Amounts): AmountsView => ({ total: m(a.total), returns: m(a.returns), payments: m(a.payments), outstanding: m(a.outstanding), buckets: { CURRENT: m(a.buckets.CURRENT), D31_60: m(a.buckets.D31_60), D61_90: m(a.buckets.D61_90), OVER_90: m(a.buckets.OVER_90) } });
const sectionView = (s: AgingSection): SectionView => ({
  reconciled: s.reconciled,
  totals: amountsView(s.totals),
  documents: s.groups.reduce((n, g) => n + g.rows.length, 0),
  groups: s.groups.map((g) => ({
    partyId: g.partyId,
    partyName: g.partyName,
    sub: amountsView(g.sub),
    rows: g.rows.map((r) => ({ id: r.id, reference: r.reference, date: r.date, days: r.days, bucket: r.bucket, status: r.status, total: m(r.total), returns: m(r.appliedReturns), payments: m(r.appliedPayments), outstanding: m(r.outstanding) })),
  })),
});
const cents = (v: { toFixed: (n: number) => string }) => toUnits(v.toFixed(2), 2);
const sum = (xs: { grandTotal?: { toFixed: (n: number) => string }; amount?: { toFixed: (n: number) => string } }[]) => xs.reduce((n, x) => n + cents((x.grandTotal ?? x.amount)!), BigInt(0));
const dateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10); // MySQL DATE -> UTC midnight

/** Names of the filter targets, or an error code when the id does not exist. */
export async function resolveAgingFilters(p: AgingParams): Promise<{ ok: true; customer: { id: string; name: string } | null; supplier: { id: string; name: string } | null } | { ok: false; error: "errCustomer" | "errSupplier" }> {
  let customer: { id: string; name: string } | null = null;
  let supplier: { id: string; name: string } | null = null;
  if (wantsAR(p.type) && p.customerId) {
    customer = await db.customer.findUnique({ where: { id: p.customerId }, select: { id: true, name: true } });
    if (!customer) return { ok: false, error: "errCustomer" };
  }
  if (wantsAP(p.type) && p.supplierId) {
    supplier = await db.supplier.findUnique({ where: { id: p.supplierId }, select: { id: true, name: true } });
    if (!supplier) return { ok: false, error: "errSupplier" };
  }
  return { ok: true, customer, supplier };
}

export async function getAging(p: AgingParams & { currency: AgingCurrency; iconRight: boolean; customer: { id: string; name: string } | null; supplier: { id: string; name: string } | null }): Promise<AgingReport> {
  const asOfDate = dateOnly(p.asOf);
  const R = p.currency.id;

  const [sales, purchases] = await Promise.all([
    wantsAR(p.type)
      ? db.sale.findMany({
          where: { status: "COMPLETED", currencyId: R, saleDate: { lte: asOfDate }, ...(p.customer ? { customerId: p.customer.id } : {}) },
          select: {
            id: true,
            reference: true,
            saleDate: true,
            grandTotal: true,
            customer: { select: { id: true, name: true } },
            returns: { where: { status: "COMPLETED", returnDate: { lte: asOfDate } }, select: { grandTotal: true } },
            paymentAllocations: { where: { payment: { paymentDate: { lte: asOfDate } } }, select: { amount: true } },
          },
        })
      : Promise.resolve([]),
    wantsAP(p.type)
      ? db.purchase.findMany({
          where: { currencyId: R, purchaseDate: { lte: asOfDate }, ...(p.supplier ? { supplierId: p.supplier.id } : {}) },
          select: {
            id: true,
            reference: true,
            purchaseDate: true,
            status: true,
            grandTotal: true,
            supplier: { select: { id: true, name: true } },
            returns: { where: { status: "COMPLETED", returnDate: { lte: asOfDate } }, select: { grandTotal: true } },
            paymentAllocations: { where: { payment: { paymentDate: { lte: asOfDate } } }, select: { amount: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const receivables = wantsAR(p.type)
    ? sectionView(buildAging(sales.map((s) => ({ id: s.id, partyId: s.customer.id, partyName: s.customer.name, reference: s.reference, date: iso(s.saleDate), status: null, total: cents(s.grandTotal), returns: sum(s.returns), payments: sum(s.paymentAllocations) })), p.asOf))
    : null;
  const payables = wantsAP(p.type)
    ? sectionView(buildAging(purchases.map((x) => ({ id: x.id, partyId: x.supplier.id, partyName: x.supplier.name, reference: x.reference, date: iso(x.purchaseDate), status: x.status, total: cents(x.grandTotal), returns: sum(x.returns), payments: sum(x.paymentAllocations) })), p.asOf))
    : null;
  return { type: p.type, asOf: p.asOf, currency: { ...p.currency, right: p.iconRight }, customer: p.customer, supplier: p.supplier, receivables, payables };
}
