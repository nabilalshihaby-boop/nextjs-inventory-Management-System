"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { LedgerError, appendLedgerRow, dateOnly, ledgerTxOptions, lockAccounts } from "@/lib/cash-bank-ledger";
import { formatMoney } from "@/lib/money";
import { canManageCustomerPayments } from "@/lib/roles";
import { getSystemSettings } from "@/lib/settings";
import { CUSTOMER_PAYMENT_PURPOSE, customerPaymentInputSchema, formatCustomerPaymentReference, type CustomerPaymentField } from "@/lib/customer-payments";

// Customer Payments — a real receipt, not a generic deposit. Integrity rules (server-side, ONE
// transaction, READ COMMITTED):
// 1. auth() is re-read and must be OWNER/ADMIN; the role never comes from the client. Unknown
//    payload keys are rejected (zod .strict()).
// 2. The allocated sales are locked first (SELECT … FOR UPDATE, id order) and then the receiving
//    account (shared ledger lock), so concurrent receipts can't overpay a sale. Lock order is
//    sales → account everywhere (sales returns / completion lock only the sale) → no deadlocks.
// 3. Every sale must exist, belong to the chosen customer, be COMPLETED, use the account's
//    currency, and the payment date can't be before its sale date.
// 4. Each allocation must be > 0 and ≤ the sale's real Due, re-read under the lock:
//       Due = max(0, Grand Total − completed sales-return totals − Paid)
//    where Paid = Σ earlier customer-payment allocations (kept in Sale.paidAmount, updated here).
// 5. The claimed amount must equal Σ allocations exactly (zod and again here).
// 6. The account must be active and in the sales' currency. A receipt INCREASES the balance, so
//    no sufficient-balance or backdating check is needed for it.
// 7. Creates the immutable payment + allocations, increments each Sale.paidAmount by its
//    allocation, and appends exactly ONE Cash/Bank DEPOSIT linked to the payment.
// No stock, sale lines, product, purchase or supplier data is touched. Payments are immutable (no
// edit/delete actions). Unallocated receipts, customer credit and refunds are not built.

export type CustomerPaymentResult = { ok: true; message: string; id?: string } | { ok: false; message: string; fieldErrors?: Partial<Record<CustomerPaymentField, string>> };

const isKnown = (e: unknown, ...codes: string[]) => e instanceof Prisma.PrismaClientKnownRequestError && codes.includes(e.code);
const FIELD: Record<string, CustomerPaymentField> = { amount: "amount", paymentDate: "paymentDate", cashBankAccountId: "cashBankAccountId", customerId: "customerId", allocations: "allocations" };
const fail = (message: string, field?: CustomerPaymentField): never => {
  throw new LedgerError(message, field);
};

async function authorize(): Promise<{ userId: string } | { error: CustomerPaymentResult }> {
  const s = await auth();
  if (!s?.user?.id) return { error: { ok: false, message: "Your session has expired. Please sign in again." } };
  if (!canManageCustomerPayments(s.user.role)) return { error: { ok: false, message: "You don't have permission to record customer payments." } };
  return { userId: s.user.id };
}

export async function recordCustomerPayment(input: unknown): Promise<CustomerPaymentResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const v = customerPaymentInputSchema.safeParse(input);
  if (!v.success) {
    const fieldErrors: Partial<Record<CustomerPaymentField, string>> = {};
    for (const i of v.error.issues) fieldErrors[(i.path[0] as CustomerPaymentField) ?? "allocations"] ??= i.code === "unrecognized_keys" ? "Unexpected fields were sent" : i.message;
    return { ok: false, message: Object.values(fieldErrors)[0] ?? "Please check the form", fieldErrors };
  }
  const d = v.data;
  const settings = await getSystemSettings();

  for (let attempt = 1; ; attempt++) {
    try {
      const created = await db.$transaction(async (tx) => {
        const customer = await tx.customer.findUnique({ where: { id: d.customerId }, select: { id: true, name: true } });
        if (!customer) fail("Choose a valid customer", "customerId");

        // Lock the sales first (stable id order), then re-read them.
        const ids = [...new Set(d.allocations.map((x) => x.saleId))].sort();
        await tx.$queryRaw`SELECT id FROM sales WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
        const sales = await tx.sale.findMany({ where: { id: { in: ids } }, select: { id: true, reference: true, customerId: true, status: true, currencyId: true, saleDate: true, grandTotal: true, paidAmount: true, currency: { select: { symbol: true } } } });
        const byId = new Map(sales.map((s) => [s.id, s]));
        const returned = new Map((await tx.saleReturn.groupBy({ by: ["saleId"], where: { saleId: { in: ids } }, _sum: { grandTotal: true } })).map((r) => [r.saleId, r._sum.grandTotal ?? new Prisma.Decimal(0)]));

        const lines = d.allocations.map((al) => {
          const s = byId.get(al.saleId) ?? fail("A selected sale no longer exists", "allocations");
          if (s.customerId !== customer!.id) fail(`${s.reference} belongs to another customer.`, "allocations");
          if (s.status !== "COMPLETED") fail(`${s.reference} is Pending — only completed sales can be paid.`, "allocations");
          if (dateOnly(d.paymentDate) < s.saleDate) fail(`The payment date can't be before the date of ${s.reference}.`, "paymentDate");
          const due = new Prisma.Decimal(s.grandTotal).minus(returned.get(s.id) ?? 0).minus(s.paidAmount);
          const money = (x: Prisma.Decimal) => formatMoney(x.toFixed(2), { code: "", symbol: s.currency.symbol, right: !!settings?.currencyIconRight });
          if (!due.gt(0)) fail(`${s.reference} has nothing left to pay.`, "allocations");
          if (new Prisma.Decimal(al.amount).gt(due)) fail(`${money(new Prisma.Decimal(al.amount))} is more than the ${money(due)} still due on ${s.reference}.`, "allocations");
          return { s, amount: al.amount };
        });
        if (new Set(lines.map((l) => l.s.currencyId)).size !== 1) fail("All selected sales must use the same currency.", "allocations");
        const total = lines.reduce((sum, l) => sum.plus(l.amount), new Prisma.Decimal(0));
        if (!total.equals(d.amount)) fail("The payment amount must equal the sum of the allocations.", "amount");

        // Then lock and check the receiving account.
        const acc = (await lockAccounts(tx, [d.cashBankAccountId])).get(d.cashBankAccountId) ?? fail("Choose a valid cash/bank account", "cashBankAccountId");
        if (acc.status !== "ACTIVE") fail(`${acc.name} is inactive and can't be used for new transactions.`, "cashBankAccountId");
        if (acc.currencyId !== lines[0].s.currencyId) fail(`${acc.name} uses a different currency from the selected sales.`, "cashBankAccountId");

        // Immutable payment + allocations; Sale Paid updated in the same transaction.
        const p0 = await tx.customerPayment.create({
          data: {
            reference: `TMP_${randomBytes(8).toString("hex")}`, // replaced below, inside this transaction
            paymentDate: dateOnly(d.paymentDate),
            customerId: customer!.id,
            cashBankAccountId: acc.id,
            currencyId: acc.currencyId,
            amount: total,
            paymentMethod: d.paymentMethod,
            externalReference: d.externalReference || null,
            notes: d.notes || null,
            createdById: a.userId,
            allocations: { create: lines.map((l) => ({ saleId: l.s.id, amount: l.amount })) },
          },
          select: { id: true, number: true },
        });
        const reference = formatCustomerPaymentReference(p0.number);
        await tx.customerPayment.update({ where: { id: p0.id }, data: { reference } });
        for (const l of lines) await tx.sale.update({ where: { id: l.s.id }, data: { paidAmount: { increment: l.amount } } });
        // Exactly one append-only ledger DEPOSIT, linked to the payment.
        const dep = await appendLedgerRow(tx, "DEPOSIT", {
          transactionDate: dateOnly(d.paymentDate),
          accountId: acc.id,
          amount: total,
          paymentMethod: d.paymentMethod,
          purpose: CUSTOMER_PAYMENT_PURPOSE,
          notes: `${reference} · ${customer!.name} · ${lines.map((l) => l.s.reference).join(", ")}${d.externalReference ? ` · Ref ${d.externalReference}` : ""}`,
          createdById: a.userId,
          customerPaymentId: p0.id,
        });
        return { id: p0.id, reference, ledger: dep.reference, refs: lines.map((l) => l.s.reference) };
      }, ledgerTxOptions);
      revalidatePath("/customer-payments");
      revalidatePath("/sales");
      for (const id of d.allocations.map((x) => x.saleId)) revalidatePath(`/sales/${id}`);
      revalidatePath("/finance/accounts");
      revalidatePath("/finance/transactions");
      return { ok: true, message: `Payment ${created.reference} recorded (${created.ledger}) — applied to ${created.refs.join(", ")}`, id: created.id };
    } catch (e) {
      if (e instanceof LedgerError) {
        const field = e.field ? FIELD[e.field] : undefined;
        return { ok: false, message: e.message, fieldErrors: field ? { [field]: e.message } : undefined };
      }
      if (attempt < 4 && isKnown(e, "P2034")) continue; // deadlock / write conflict → retry
      if (isKnown(e, "P2003")) return { ok: false, message: "A selected customer, sale or account no longer exists. Refresh and try again." };
      throw e;
    }
  }
}
