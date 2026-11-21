"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { LedgerError, appendLedgerRow, assertChronology, assertSufficient, dateOnly, ledgerTxOptions, lockAccounts } from "@/lib/cash-bank-ledger";
import { formatMoney } from "@/lib/money";
import { canManageSupplierPayments } from "@/lib/roles";
import { getSystemSettings } from "@/lib/settings";
import { SUPPLIER_PAYMENT_PURPOSE, formatSupplierPaymentReference, makeSupplierPaymentSchema, type SupplierPaymentField } from "@/lib/supplier-payments";
import { getDict } from "@/lib/i18n/server";
import { LocalizedError, errorMessage, tr, type Vars } from "@/lib/i18n/messages";
import type { Dictionary } from "@/lib/i18n";

// Supplier Payments. Financial-integrity rules (server-side, ONE transaction, READ COMMITTED):
// 1. auth() is re-read and must be OWNER/ADMIN; the role never comes from the client.
// 2. The allocated purchases are locked (SELECT … FOR UPDATE, id order) and then the paying account
//    (shared ledger lock), so concurrent payments can't overpay an invoice or overspend an account.
//    Lock order everywhere: purchases → account (returns lock only the purchase), so no deadlocks.
// 3. Every purchase must exist, belong to the chosen supplier, use the account's currency, and
//    the payment date can't be before its purchase date.
// 4. Each allocation must be > 0 and ≤ the purchase's real Due = Grand Total − Paid − completed
//    returns, all re-read under the lock (client dues/paid/totals are ignored).
// 5. The claimed amount must equal Σ allocations exactly (checked in zod and again here).
// 6. The account must be active, in the purchases' currency, have enough CURRENT balance, and the
//    date must not make its CHRONOLOGICAL running balance negative (shared ledger rules).
// 7. Creates the immutable payment + allocations, increments each Purchase.paidAmount by its
//    allocation, and appends exactly ONE Cash/Bank WITHDRAWAL linked to the payment.
// Payments are immutable (no edit/delete actions). Refunds / supplier credit are not built.

export type SupplierPaymentResult = { ok: true; message: string; id?: string } | { ok: false; message: string; fieldErrors?: Partial<Record<SupplierPaymentField, string>> };

const isKnown = (e: unknown, ...codes: string[]) => e instanceof Prisma.PrismaClientKnownRequestError && codes.includes(e.code);
const FIELD: Record<string, SupplierPaymentField> = { amount: "amount", transactionDate: "paymentDate", paymentDate: "paymentDate", cashBankAccountId: "cashBankAccountId", supplierId: "supplierId", allocations: "allocations" };
// Carries a dictionary key (+ variables); translated with the request dictionary in the catch below.
class PaymentError extends LocalizedError {
  constructor(key: string, vars: Vars, readonly field?: SupplierPaymentField) {
    super(key, vars);
  }
}
const fail = (key: string, vars: Vars = {}, field?: SupplierPaymentField): never => {
  throw new PaymentError(key, vars, field);
};

async function authorize(): Promise<{ userId: string; t: Dictionary } | { error: SupplierPaymentResult }> {
  const s = await auth();
  const t = await getDict();
  if (!s?.user?.id) return { error: { ok: false, message: t.common.sessionExpired } };
  if (!canManageSupplierPayments(s.user.role)) return { error: { ok: false, message: t.supplierPay.err.noPermission } };
  return { userId: s.user.id, t };
}

export async function recordSupplierPayment(input: unknown): Promise<SupplierPaymentResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const t = a.t;
  const v = makeSupplierPaymentSchema(t.supplierPay.val, t.sales.val).safeParse(input);
  if (!v.success) {
    const fieldErrors: Partial<Record<SupplierPaymentField, string>> = {};
    for (const i of v.error.issues) fieldErrors[(i.path[0] as SupplierPaymentField) ?? "allocations"] ??= i.message;
    return { ok: false, message: Object.values(fieldErrors)[0] ?? t.common.checkForm, fieldErrors };
  }
  const d = v.data;
  const settings = await getSystemSettings();

  for (let attempt = 1; ; attempt++) {
    try {
      const created = await db.$transaction(async (tx) => {
        const supplier = await tx.supplier.findUnique({ where: { id: d.supplierId }, select: { id: true, name: true } });
        if (!supplier) fail("supplierPay.err.supplierGone", {}, "supplierId");

        // Lock the purchases first (stable id order), then re-read them.
        const ids = [...new Set(d.allocations.map((x) => x.purchaseId))].sort();
        await tx.$queryRaw`SELECT id FROM purchases WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
        const purchases = await tx.purchase.findMany({ where: { id: { in: ids } }, select: { id: true, reference: true, supplierId: true, currencyId: true, purchaseDate: true, grandTotal: true, paidAmount: true, currency: { select: { symbol: true } } } });
        const byId = new Map(purchases.map((p) => [p.id, p]));
        const returned = new Map(
          (await tx.purchaseReturn.groupBy({ by: ["purchaseId"], where: { purchaseId: { in: ids } }, _sum: { grandTotal: true } })).map((r) => [r.purchaseId, r._sum.grandTotal ?? new Prisma.Decimal(0)]),
        );

        const lines = d.allocations.map((al) => {
          const p = byId.get(al.purchaseId) ?? fail("supplierPay.err.purchaseGone", {}, "allocations");
          if (p.supplierId !== supplier!.id) fail("supplierPay.err.otherSupplier", { ref: p.reference }, "allocations");
          if (dateOnly(d.paymentDate) < p.purchaseDate) fail("supplierPay.err.beforePurchase", { ref: p.reference }, "paymentDate");
          const due = new Prisma.Decimal(p.grandTotal).minus(p.paidAmount).minus(returned.get(p.id) ?? 0);
          const money = (x: Prisma.Decimal) => formatMoney(x.toFixed(2), { code: "", symbol: p.currency.symbol, right: !!settings?.currencyIconRight });
          if (!due.gt(0)) fail("supplierPay.err.nothingToPay", { ref: p.reference }, "allocations");
          if (new Prisma.Decimal(al.amount).gt(due)) fail("supplierPay.err.tooMuch", { amount: money(new Prisma.Decimal(al.amount)), due: money(due), ref: p.reference }, "allocations");
          return { p, amount: al.amount };
        });
        const currencies = new Set(lines.map((l) => l.p.currencyId));
        if (currencies.size !== 1) fail("supplierPay.err.sameCurrency", {}, "allocations");
        const total = lines.reduce((s, l) => s.plus(l.amount), new Prisma.Decimal(0));
        if (!total.equals(d.amount)) fail("supplierPay.err.sumMismatch", {}, "amount");

        // Then lock and check the paying account (current + chronological balance).
        const acc = (await lockAccounts(tx, [d.cashBankAccountId])).get(d.cashBankAccountId) ?? fail("supplierPay.err.accountInvalid", {}, "cashBankAccountId");
        if (acc.status !== "ACTIVE") fail("supplierPay.err.accountInactive", { name: acc.name }, "cashBankAccountId");
        if (acc.currencyId !== lines[0].p.currencyId) fail("supplierPay.err.accountCurrency", { name: acc.name }, "cashBankAccountId");
        await assertSufficient(tx, acc, total, "amount");
        await assertChronology(tx, acc, dateOnly(d.paymentDate), total.negated(), "paymentDate");

        // Immutable payment + allocations; purchase Paid updated in the same transaction.
        const p0 = await tx.supplierPayment.create({
          data: {
            reference: `TMP_${randomBytes(8).toString("hex")}`, // replaced below, inside this transaction
            paymentDate: dateOnly(d.paymentDate),
            supplierId: supplier!.id,
            cashBankAccountId: acc.id,
            currencyId: acc.currencyId,
            amount: total,
            paymentMethod: d.paymentMethod,
            externalReference: d.externalReference || null,
            notes: d.notes || null,
            createdById: a.userId,
            allocations: { create: lines.map((l) => ({ purchaseId: l.p.id, amount: l.amount })) },
          },
          select: { id: true, number: true },
        });
        const reference = formatSupplierPaymentReference(p0.number);
        await tx.supplierPayment.update({ where: { id: p0.id }, data: { reference } });
        for (const l of lines) await tx.purchase.update({ where: { id: l.p.id }, data: { paidAmount: { increment: l.amount } } });
        // Exactly one append-only ledger withdrawal, linked to the payment.
        const w = await appendLedgerRow(tx, "WITHDRAWAL", {
          transactionDate: dateOnly(d.paymentDate),
          accountId: acc.id,
          amount: total,
          paymentMethod: d.paymentMethod,
          purpose: SUPPLIER_PAYMENT_PURPOSE,
          notes: `${reference} · ${supplier!.name} · ${lines.map((l) => l.p.reference).join(", ")}${d.externalReference ? ` · Ref ${d.externalReference}` : ""}`,
          createdById: a.userId,
          supplierPaymentId: p0.id,
        });
        return { id: p0.id, reference, ledger: w.reference, refs: lines.map((l) => l.p.reference) };
      }, ledgerTxOptions);
      revalidatePath("/supplier-payments");
      revalidatePath("/purchases");
      for (const id of d.allocations.map((x) => x.purchaseId)) revalidatePath(`/purchases/${id}`);
      revalidatePath("/finance/accounts");
      revalidatePath("/finance/transactions");
      return { ok: true, message: tr(t, "supplierPay.ok.recorded", { ref: created.reference, ledger: created.ledger, purchases: created.refs.join(", ") }), id: created.id };
    } catch (e) {
      if (e instanceof PaymentError) {
        const message = errorMessage(t, e);
        return { ok: false, message, fieldErrors: e.field ? { [e.field]: message } : undefined };
      }
      if (e instanceof LedgerError) {
        const field = e.field ? FIELD[e.field] : undefined;
        const message = e.i18n ? tr(t, e.i18n.key, e.i18n.vars) : e.message;
        return { ok: false, message, fieldErrors: field ? { [field]: message } : undefined };
      }
      if (attempt < 4 && isKnown(e, "P2034")) continue; // deadlock / write conflict → retry
      if (isKnown(e, "P2003")) return { ok: false, message: t.supplierPay.err.refsGone };
      throw e;
    }
  }
}
