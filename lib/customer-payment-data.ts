// Server-only loaders for Customer Payments (OWNER/ADMIN — callers check the role first).
// Everything here is display only: the record action re-reads and re-checks all of it under locks.
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { computeBalances } from "@/lib/cash-bank-server";
import { formatDateOnly, formatDateTime } from "@/lib/format";
import { getLocale } from "@/lib/i18n/server";
import { getDefaultCurrency, getSystemSettings } from "@/lib/settings";
import type { CustomerPaymentRow, PayableSale, PaymentCurrency, ReceivingAccount } from "@/lib/customer-payments";

export type CustomerPaymentFormData = {
  customers: { id: string; name: string }[];
  payables: PayableSale[];
  accounts: ReceivingAccount[];
  currencies: PaymentCurrency[];
};

/**
 * Real customers, every COMPLETED sale with Due > 0 — Due = Grand Total − Paid − completed sales
 * returns — and ACTIVE cash/bank accounts (with their computed balance, for reference).
 */
export async function getCustomerPaymentFormData(): Promise<CustomerPaymentFormData> {
  const settings = await getSystemSettings();
  const right = !!settings?.currencyIconRight;
  const [customers, sales, accounts] = await Promise.all([
    db.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.sale.findMany({
      where: { status: "COMPLETED" },
      orderBy: [{ saleDate: "asc" }, { number: "asc" }],
      select: { id: true, reference: true, customerId: true, saleDate: true, currencyId: true, grandTotal: true, paidAmount: true, currency: { select: { id: true, code: true, symbol: true } } },
    }),
    db.cashBankAccount.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, currencyId: true, currency: { select: { id: true, code: true, symbol: true } } } }),
  ]);
  const returned = new Map(
    (await db.saleReturn.groupBy({ by: ["saleId"], _sum: { grandTotal: true } })).map((r) => [r.saleId, r._sum.grandTotal ?? new Prisma.Decimal(0)]),
  );
  const balances = await computeBalances(db, accounts.map((a) => a.id));
  const currencies = new Map<string, PaymentCurrency>();
  for (const c of [...sales.map((s) => s.currency), ...accounts.map((a) => a.currency)]) currencies.set(c.id, { id: c.id, code: c.code, symbol: c.symbol, right });

  const payables: PayableSale[] = [];
  for (const s of sales) {
    const ret = returned.get(s.id) ?? new Prisma.Decimal(0);
    const due = s.grandTotal.minus(s.paidAmount).minus(ret);
    if (!due.gt(0)) continue;
    payables.push({
      id: s.id,
      customerId: s.customerId,
      reference: s.reference,
      date: s.saleDate.toISOString().slice(0, 10),
      dateLabel: formatDateOnly(s.saleDate, settings?.dateFormat),
      status: "Completed",
      currencyId: s.currencyId,
      grandTotal: s.grandTotal.toFixed(2),
      paid: s.paidAmount.toFixed(2),
      returned: ret.toFixed(2),
      due: due.toFixed(2),
    });
  }
  return {
    customers,
    payables,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, balance: (balances.get(a.id) ?? new Prisma.Decimal(0)).toFixed(2), currencyId: a.currencyId, currencyCode: a.currency.code })),
    currencies: [...currencies.values()],
  };
}

/** Every recorded customer payment (newest first), with its allocations and linked ledger deposit. */
export async function getCustomerPaymentRows(): Promise<CustomerPaymentRow[]> {
  const locale = await getLocale();
  const [settings, def] = await Promise.all([getSystemSettings(), getDefaultCurrency()]);
  const rows = await db.customerPayment.findMany({
    orderBy: [{ paymentDate: "desc" }, { number: "desc" }],
    select: {
      id: true, reference: true, paymentDate: true, customerId: true, amount: true, paymentMethod: true, externalReference: true, notes: true, createdById: true, createdAt: true, currencyId: true,
      customer: { select: { name: true } },
      cashBankAccount: { select: { name: true } },
      currency: { select: { code: true, symbol: true } },
      ledgerEntry: { select: { reference: true } },
      allocations: { orderBy: { sale: { number: "asc" } }, select: { amount: true, saleId: true, sale: { select: { reference: true } } } },
    },
  });
  const userIds = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))];
  const users = new Map((userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }) : []).map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    date: r.paymentDate.toISOString().slice(0, 10),
    dateLabel: formatDateOnly(r.paymentDate, settings?.dateFormat),
    customerId: r.customerId,
    customer: r.customer.name,
    method: r.paymentMethod,
    account: r.cashBankAccount.name,
    amount: r.amount.toFixed(2),
    appliedTo: r.allocations.map((a) => ({ reference: a.sale.reference, saleId: a.saleId, amount: a.amount.toFixed(2) })),
    externalReference: r.externalReference ?? "",
    notes: r.notes ?? "",
    ledgerReference: r.ledgerEntry?.reference ?? "—",
    createdBy: (r.createdById && users.get(r.createdById)) || "—",
    createdOn: formatDateTime(r.createdAt, settings?.dateFormat, locale),
    currency: { code: r.currency.code, symbol: r.currency.symbol, right: !!settings?.currencyIconRight },
    inDefaultCurrency: !!def && r.currencyId === def.id,
  }));
}
