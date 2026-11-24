"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { LedgerError, appendLedgerRow, assertChronology, assertSufficient, dateOnly, ledgerFail, ledgerTxOptions, lockAccounts, type LockedAccount, type Tx } from "@/lib/cash-bank-ledger";
import { getDict } from "@/lib/i18n/server";
import { tr } from "@/lib/i18n/messages";
import type { Dictionary } from "@/lib/i18n";
import { canManageExpenses } from "@/lib/roles";
import { getDefaultCurrency } from "@/lib/settings";
import { EXPENSE_PURPOSE, EXPENSE_REVERSAL_PURPOSE, makeExpenseSchema, formatExpenseReference, type ExpenseField, type ExpenseInput } from "@/lib/expenses";

// Expenses. Financial-integrity rules (all server-side, using the shared ledger rules in
// lib/cash-bank-ledger.ts — the same locking, overdraft and backdating checks as Cash & Bank):
// - OWNER/ADMIN only; auth() is re-read in every action and the role never comes from the client.
// - Create = ONE transaction: lock the account, check it is active and in the default currency,
//   check current + chronological balance, create the Expense, append a WITHDRAWAL (purpose
//   "Operating Expense") linked to it, and point the Expense at that ledger row.
// - The ledger is append-only. Edit (when date/amount/account change) = ONE transaction: lock the
//   expense and the account rows, append a reversal DEPOSIT of the original amount into the
//   original account (dated on the original expense date, so it cancels the original at the same
//   point in history), validate the new values against the corrected ledger, append a new
//   WITHDRAWAL, and re-point the Expense. Delete = append a reversal DEPOSIT and set deletedAt.
//   No ledger row is ever updated or deleted (only the in-transaction reference assignment).
// - Warehouse, category and account are looked up in MySQL; balances, references and amounts
//   from the browser are never used.

export type ExpenseResult = { ok: true; message: string; reference?: string } | { ok: false; message: string; fieldErrors?: Partial<Record<ExpenseField, string>> };

const idSchema = z.string().trim().min(1).max(64);
async function authorize(): Promise<{ userId: string; t: Dictionary } | { error: ExpenseResult }> {
  const s = await auth();
  const t = await getDict();
  if (!s?.user?.id) return { error: { ok: false, message: t.common.sessionExpired } };
  if (!canManageExpenses(s.user)) return { error: { ok: false, message: t.expenses.err.noPermission } };
  return { userId: s.user.id, t };
}

function parse(input: unknown, t: Dictionary): { ok: true; data: ExpenseInput } | { ok: false; error: ExpenseResult } {
  const v = makeExpenseSchema(t.expenses.val, t.finance.val).safeParse(input);
  if (v.success) return { ok: true, data: v.data };
  const fieldErrors: Partial<Record<ExpenseField, string>> = {};
  for (const i of v.error.issues) fieldErrors[i.path[0] as ExpenseField] ??= i.message;
  return { ok: false, error: { ok: false, message: Object.values(fieldErrors)[0] ?? t.common.checkForm, fieldErrors } };
}

/** Warehouse and category must exist (the account is checked under its lock inside the transaction). */
async function checkRefs(d: ExpenseInput, t: Dictionary): Promise<ExpenseResult | null> {
  const [w, c] = await Promise.all([
    db.warehouse.findUnique({ where: { id: d.warehouseId }, select: { id: true } }),
    db.expenseCategory.findUnique({ where: { id: d.categoryId }, select: { id: true } }),
  ]);
  if (!w) return { ok: false, message: t.expenses.err.invalidWarehouse, fieldErrors: { warehouseId: t.expenses.err.invalidWarehouse } };
  if (!c) return { ok: false, message: t.expenses.err.invalidCategory, fieldErrors: { categoryId: t.expenses.err.invalidCategory } };
  return null;
}

const isKnown = (e: unknown, ...codes: string[]) => e instanceof Prisma.PrismaClientKnownRequestError && codes.includes(e.code);
const FIELD: Record<string, ExpenseField> = { amount: "amount", transactionDate: "expenseDate", expenseDate: "expenseDate", accountId: "cashBankAccountId", cashBankAccountId: "cashBankAccountId" };

async function run(t: Dictionary, fn: (tx: Tx) => Promise<string>): Promise<{ ok: true; message: string } | { ok: false; error: ExpenseResult }> {
  try {
    const message = await db.$transaction(fn, ledgerTxOptions);
    revalidatePath("/expenses");
    revalidatePath("/finance/accounts");
    revalidatePath("/finance/transactions");
    return { ok: true, message };
  } catch (e) {
        if (e instanceof LedgerError) {
      const field = e.field ? FIELD[e.field] : undefined;
      const message = e.i18n ? tr(t, e.i18n.key, e.i18n.vars) : e.message;
      return { ok: false, error: { ok: false, message, fieldErrors: field ? { [field]: message } : undefined } };
    }
    if (isKnown(e, "P2034")) return { ok: false, error: { ok: false, message: t.finance.err.busy } };
    if (isKnown(e, "P2003")) return { ok: false, error: { ok: false, message: t.expenses.err.refsGone } };
    throw e;
  }
}

/** The account the expense is paid from: must exist, be active and use the default currency. */
function payingAccount(acc: LockedAccount | undefined, currencyId: string): LockedAccount {
    if (!acc) return ledgerFail("finance.err.invalidAccount", {}, "cashBankAccountId");
  if (acc.status !== "ACTIVE") ledgerFail("finance.err.inactiveUse", { name: acc.name }, "cashBankAccountId");
  if (acc.currencyId !== currencyId) ledgerFail("expenses.err.notDefaultCurrency", { name: acc.name }, "cashBankAccountId");
  return acc;
}
const method = (acc: LockedAccount) => (acc.type === "CASH" ? "Cash" : "Bank Transfer");

/** Validate and append the expense WITHDRAWAL (current balance + chronological balance). */
async function withdraw(tx: Tx, acc: LockedAccount, d: ExpenseInput, expenseId: string, reference: string, userId: string) {
  await assertSufficient(tx, acc, d.amount, "amount");
  await assertChronology(tx, acc, dateOnly(d.expenseDate), new Prisma.Decimal(d.amount).negated(), "expenseDate");
  return appendLedgerRow(tx, "WITHDRAWAL", {
    transactionDate: dateOnly(d.expenseDate),
    accountId: acc.id,
    amount: d.amount,
    paymentMethod: method(acc),
    purpose: EXPENSE_PURPOSE,
    notes: `${reference} · ${d.title}`,
    createdById: userId,
    expenseId,
  });
}

/** Lock the (non-deleted) expense row first, then read it — serializes edits/deletes of one expense. */
async function lockExpense(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM expenses WHERE id = ${id} FOR UPDATE`;
  const e = await tx.expense.findUnique({
    where: { id },
    select: { id: true, reference: true, expenseDate: true, amount: true, cashBankAccountId: true, deletedAt: true, activeTransaction: { select: { reference: true } } },
  });
  if (!e || e.deletedAt) ledgerFail("expenses.err.notFound");
  return e!;
}

/** Reversal DEPOSIT of the original amount into the original account, dated on the original date. */
async function reverse(tx: Tx, orig: Awaited<ReturnType<typeof lockExpense>>, acc: LockedAccount, why: "updated" | "deleted", userId: string) {
  if (acc.status !== "ACTIVE") ledgerFail("expenses.err.reverseInactive", { name: acc.name }, "cashBankAccountId");
  await assertChronology(tx, acc, orig.expenseDate, new Prisma.Decimal(orig.amount)); // money in: always passes
  return appendLedgerRow(tx, "DEPOSIT", {
    transactionDate: orig.expenseDate,
    accountId: acc.id,
    amount: orig.amount,
    paymentMethod: method(acc),
    purpose: EXPENSE_REVERSAL_PURPOSE,
    notes: `Reversal of ${orig.activeTransaction?.reference ?? "the original payment"} (${orig.reference} ${why})`,
    createdById: userId,
    expenseId: orig.id,
  });
}

export async function createExpense(input: unknown): Promise<ExpenseResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
    const t = a.t;
  const v = parse(input, t);
  if (!v.ok) return v.error;
  const currency = await getDefaultCurrency();
  if (!currency) return { ok: false, message: t.expenses.err.noCurrency, fieldErrors: { amount: t.expenses.err.noCurrency } };
  const bad = await checkRefs(v.data, t);
  if (bad) return bad;
  const d = v.data;

    const r = await run(t, async (tx) => {
    const acc = payingAccount((await lockAccounts(tx, [d.cashBankAccountId])).get(d.cashBankAccountId), currency.id);
    // withdraw() validates current + chronological balance; any rejection rolls back the whole
    // transaction, including this expense row (nothing is written).
    const e0 = await tx.expense.create({
      data: {
        reference: `TMP_${randomBytes(8).toString("hex")}`, // replaced below, inside this transaction
        expenseDate: dateOnly(d.expenseDate),
        title: d.title,
        warehouseId: d.warehouseId,
        categoryId: d.categoryId,
        cashBankAccountId: acc.id,
        amount: d.amount,
        details: d.details || null,
        createdById: a.userId,
      },
      select: { id: true, number: true },
    });
    const reference = formatExpenseReference(e0.number);
    const w = await withdraw(tx, acc, d, e0.id, reference, a.userId);
    await tx.expense.update({ where: { id: e0.id }, data: { reference, activeTransactionId: w.id } });
    return tr(t, "expenses.ok.created", { ref: reference, tx: w.reference, account: acc.name });
  });
  return r.ok ? { ok: true, message: r.message } : r.error;
}

/**
 * Edit. If the date, amount or paying account changes: reversal + new withdrawal in one
 * transaction. If only descriptive fields change, no ledger rows are needed.
 */
export async function updateExpense(id: unknown, input: unknown): Promise<ExpenseResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
    const t = a.t;
  const eid = idSchema.safeParse(id);
  if (!eid.success) return { ok: false, message: t.expenses.err.notFound };
  const v = parse(input, t);
  if (!v.ok) return v.error;
  const currency = await getDefaultCurrency();
  if (!currency) return { ok: false, message: t.expenses.err.noCurrency, fieldErrors: { amount: t.expenses.err.noCurrency } };
  const bad = await checkRefs(v.data, t);
  if (bad) return bad;
  const d = v.data;

    const r = await run(t, async (tx) => {
    const orig = await lockExpense(tx, eid.data);
    const descriptive = { title: d.title, warehouseId: d.warehouseId, categoryId: d.categoryId, details: d.details || null };
    const financialChange =
      orig.cashBankAccountId !== d.cashBankAccountId || !new Prisma.Decimal(orig.amount).equals(d.amount) || orig.expenseDate.toISOString().slice(0, 10) !== d.expenseDate;
    if (!financialChange) {
      await tx.expense.update({ where: { id: orig.id }, data: descriptive });
      return tr(t, "expenses.ok.updatedNoChange", { ref: orig.reference });
    }
    const locked = await lockAccounts(tx, [orig.cashBankAccountId, d.cashBankAccountId]);
    const origAcc = locked.get(orig.cashBankAccountId) ?? ledgerFail("expenses.err.originalGone");
    const newAcc = payingAccount(locked.get(d.cashBankAccountId), currency.id);
    // 1. reverse the original effect (append-only)
    const rev = await reverse(tx, orig, origAcc, "updated", a.userId);
    // 2 + 3. validate the new values against the corrected ledger and append the new withdrawal
    const w = await withdraw(tx, newAcc, d, orig.id, orig.reference, a.userId);
    // 4. update the expense and its active ledger link
    await tx.expense.update({ where: { id: orig.id }, data: { ...descriptive, expenseDate: dateOnly(d.expenseDate), amount: d.amount, cashBankAccountId: newAcc.id, activeTransactionId: w.id } });
    return tr(t, "expenses.ok.updatedReversal", { ref: orig.reference, rev: rev.reference, tx: w.reference });
  });
  return r.ok ? { ok: true, message: r.message } : r.error;
}

/** Delete = reversal deposit + soft delete. The expense row and its ledger history are kept. */
export async function deleteExpense(id: unknown): Promise<ExpenseResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
    const t = a.t;
  const eid = idSchema.safeParse(id);
  if (!eid.success) return { ok: false, message: t.expenses.err.notFound };

  const r = await run(t, async (tx) => {
    const orig = await lockExpense(tx, eid.data);
    const acc = (await lockAccounts(tx, [orig.cashBankAccountId])).get(orig.cashBankAccountId) ?? ledgerFail("expenses.err.originalGone");
    const rev = await reverse(tx, orig, acc, "deleted", a.userId);
    await tx.expense.update({ where: { id: orig.id }, data: { deletedAt: new Date(), activeTransactionId: null } });
    return tr(t, "expenses.ok.deleted", { ref: orig.reference, rev: rev.reference });
  });
  return r.ok ? { ok: true, message: r.message } : r.error;
}
