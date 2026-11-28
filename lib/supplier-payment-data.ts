// Server-only loaders for Supplier Payments (OWNER/ADMIN — callers check the role first).
// Everything here is display only: the record action re-reads and re-checks all of it under locks.
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { computeBalances } from "@/lib/cash-bank-server";
import { formatDateOnly, formatDateTime } from "@/lib/format";
import { getLocale } from "@/lib/i18n/server";
import { getDefaultCurrency, getSystemSettings } from "@/lib/settings";
import type { PayablePurchase, PayingAccount, PaymentCurrency, SupplierPaymentRow } from "@/lib/supplier-payments";

export type SupplierPaymentFormData = {
  suppliers: { id: string; name: string }[];
  payables: PayablePurchase[];
  accounts: PayingAccount[];
  currencies: PaymentCurrency[];
};

/** Real suppliers, every purchase with Due > 0 (after payments and returns), and ACTIVE accounts. */
export async function getSupplierPaymentFormData(showBalances: boolean): Promise<SupplierPaymentFormData> {
  const settings = await getSystemSettings();
  const right = !!settings?.currencyIconRight;
  const [suppliers, purchases, accounts] = await Promise.all([
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.purchase.findMany({
      orderBy: [{ purchaseDate: "asc" }, { number: "asc" }],
      select: { id: true, reference: true, supplierId: true, purchaseDate: true, status: true, currencyId: true, grandTotal: true, paidAmount: true, currency: { select: { id: true, code: true, symbol: true } } },
    }),
    db.cashBankAccount.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, currencyId: true, currency: { select: { id: true, code: true, symbol: true } } } }),
  ]);
  const returned = new Map(
    (await db.purchaseReturn.groupBy({ by: ["purchaseId"], _sum: { grandTotal: true } })).map((r) => [r.purchaseId, r._sum.grandTotal ?? new Prisma.Decimal(0)]),
  );
  const balances = showBalances ? await computeBalances(db, accounts.map((a) => a.id)) : null; // without finance.view nothing is computed or sent
  const currencies = new Map<string, PaymentCurrency>();
  for (const c of [...purchases.map((p) => p.currency), ...accounts.map((a) => a.currency)]) currencies.set(c.id, { id: c.id, code: c.code, symbol: c.symbol, right });

  const payables: PayablePurchase[] = [];
  for (const p of purchases) {
    const ret = returned.get(p.id) ?? new Prisma.Decimal(0);
    const due = p.grandTotal.minus(p.paidAmount).minus(ret);
    if (!due.gt(0)) continue;
    payables.push({
      id: p.id,
      supplierId: p.supplierId,
      reference: p.reference,
      date: p.purchaseDate.toISOString().slice(0, 10),
      dateLabel: formatDateOnly(p.purchaseDate, settings?.dateFormat),
      status: p.status,
      currencyId: p.currencyId,
      grandTotal: p.grandTotal.toFixed(2),
      paid: p.paidAmount.toFixed(2),
      returned: ret.toFixed(2),
      due: due.toFixed(2),
    });
  }
  return {
    suppliers,
    payables,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, balance: balances ? (balances.get(a.id) ?? new Prisma.Decimal(0)).toFixed(2) : null, currencyId: a.currencyId, currencyCode: a.currency.code })),
    currencies: [...currencies.values()],
  };
}

/** Every recorded supplier payment (newest first), with its allocations and linked ledger row. */
export async function getSupplierPaymentRows(): Promise<SupplierPaymentRow[]> {
  const locale = await getLocale();
  const [settings, def] = await Promise.all([getSystemSettings(), getDefaultCurrency()]);
  const rows = await db.supplierPayment.findMany({
    orderBy: [{ paymentDate: "desc" }, { number: "desc" }],
    select: {
      id: true, reference: true, paymentDate: true, supplierId: true, amount: true, paymentMethod: true, externalReference: true, notes: true, createdById: true, createdAt: true, currencyId: true,
      supplier: { select: { name: true } },
      cashBankAccount: { select: { name: true } },
      currency: { select: { code: true, symbol: true } },
      ledgerEntry: { select: { reference: true } },
      allocations: { orderBy: { purchase: { number: "asc" } }, select: { amount: true, purchaseId: true, purchase: { select: { reference: true } } } },
    },
  });
  const userIds = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))];
  const users = new Map((userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }) : []).map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    date: r.paymentDate.toISOString().slice(0, 10),
    dateLabel: formatDateOnly(r.paymentDate, settings?.dateFormat),
    supplierId: r.supplierId,
    supplier: r.supplier.name,
    method: r.paymentMethod,
    account: r.cashBankAccount.name,
    amount: r.amount.toFixed(2),
    appliedTo: r.allocations.map((a) => ({ reference: a.purchase.reference, purchaseId: a.purchaseId, amount: a.amount.toFixed(2) })),
    externalReference: r.externalReference ?? "",
    notes: r.notes ?? "",
    ledgerReference: r.ledgerEntry?.reference ?? "—",
    createdBy: (r.createdById && users.get(r.createdById)) || "—",
    createdOn: formatDateTime(r.createdAt, settings?.dateFormat, locale),
    currency: { code: r.currency.code, symbol: r.currency.symbol, right: !!settings?.currencyIconRight },
    inDefaultCurrency: !!def && r.currencyId === def.id,
  }));
}
