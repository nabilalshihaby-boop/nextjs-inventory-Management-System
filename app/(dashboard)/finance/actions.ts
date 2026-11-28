"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { LedgerError, appendLedgerRow, assertChronology, assertSufficient, dateOnly, ledgerFail, ledgerTxOptions, lockAccounts } from "@/lib/cash-bank-ledger";
import { getDict } from "@/lib/i18n/server";
import { tr } from "@/lib/i18n/messages";
import type { Dictionary } from "@/lib/i18n";
import { openRegisterBlock } from "@/lib/register-guard";
import { canManageCashBankAccounts, canRecordCashBankTransactions, canViewFinance } from "@/lib/roles";
import { getDefaultCurrency } from "@/lib/settings";
import {
    makeCashBankSchemas,
  type AccountField,
  type TxField,
} from "@/lib/cash-bank";

// Cash & Bank. Integrity rules (all server-side):
// - auth() is re-read in every action. Accounts and transactions: OWNER and ADMIN.
//   USER gets nothing. The role is never taken from the client.
// - There is no stored balance: balance = openingBalance + deposits − withdrawals − transfers out
//   + transfers in, computed from the ledger. Opening balance is set once on creation; nothing can
//   set a "current balance".
// - The transaction type comes from which action is called, never from the client. Accounts,
//   status and currency are read from MySQL inside the transaction.
// - Every money movement runs in ONE transaction (READ COMMITTED) that first locks the involved
//   account rows (SELECT … FOR UPDATE, in id order → no deadlocks), re-reads status/currency,
//   recomputes the balance from committed rows, checks it, and only then appends the ledger row.
//   Two concurrent withdrawals/transfers from one account are therefore serialized and can't
//   overdraw it; a transfer's debit and credit are one row, so it applies exactly once.
// - The ledger is append-only: there are no edit/delete actions. Accounts are deactivated, never
//   deleted (and FKs are RESTRICT).
// - No sales, purchases, customer/supplier payments or invoices are created here (Expenses record
//   their own withdrawals/reversals through the same ledger rules — see expenses/actions.ts).

export type FinanceResult<F extends string = string> =
  | { ok: true; message: string; reference?: string }
  | { ok: false; message: string; fieldErrors?: Partial<Record<F, string>> };

const idSchema = z.string().trim().min(1).max(64);
async function session() {
  const s = await auth();
  return s?.user?.id ? s.user : null;
}
const schemas = async () => {
  const t = await getDict();
  return { t, ...makeCashBankSchemas(t.finance.val) };
};

function collect<F extends string>(issues: z.core.$ZodIssue[], t: Dictionary): FinanceResult<F> {
  const fieldErrors: Partial<Record<F, string>> = {};
  for (const i of issues) fieldErrors[i.path[0] as F] ??= i.message;
  return { ok: false, message: Object.values<string | undefined>(fieldErrors)[0] ?? t.common.checkForm, fieldErrors };
}
const isKnown = (e: unknown, ...codes: string[]) => e instanceof Prisma.PrismaClientKnownRequestError && codes.includes(e.code);
const revalidate = () => {
  revalidatePath("/finance/accounts");
  revalidatePath("/finance/transactions");
};

// ---- accounts (OWNER + ADMIN) ------------------------------------------------------------------

async function accountManager(): Promise<FinanceResult<AccountField> | null> {
    const u = await session();
  const t = await getDict();
  if (!u) return { ok: false, message: t.common.sessionExpired };
  if (!canViewFinance(u) || !canManageCashBankAccounts(u)) return { ok: false, message: t.finance.err.noPermissionAccounts };
  return null;
}

export async function createAccount(input: unknown): Promise<FinanceResult<AccountField>> {
  const denied = await accountManager();
  if (denied) return denied;
    const S = await schemas();
  const DUPLICATE = S.t.finance.err.duplicate;
  const currency = await getDefaultCurrency(); // the account currency is always the default currency
  if (!currency) return { ok: false, message: S.t.finance.err.noCurrency, fieldErrors: { currency: S.t.finance.err.noCurrency } };
  const v = S.accountCreateSchema.safeParse(input);
  if (!v.success) return collect(v.error.issues, S.t);
  const d = v.data;
  if (await db.cashBankAccount.findUnique({ where: { name: d.name }, select: { id: true } })) return { ok: false, message: DUPLICATE, fieldErrors: { name: DUPLICATE } };
  try {
    await db.cashBankAccount.create({
      data: {
        name: d.name,
        type: d.type,
        reference: d.reference || null,
        bankName: d.type === "BANK" ? d.bankName : null,
        currencyId: currency.id,
        openingBalance: d.openingBalance,
        status: d.status,
        notes: d.notes || null,
      },
      select: { id: true },
    });
  } catch (e) {
    if (isKnown(e, "P2002")) return { ok: false, message: DUPLICATE, fieldErrors: { name: DUPLICATE } };
    throw e;
  }
  revalidate();
  return { ok: true, message: S.t.finance.ok.created };
}

/** Edit account details. Opening balance, currency and the (computed) balance can't be changed. */
export async function updateAccount(id: unknown, input: unknown): Promise<FinanceResult<AccountField>> {
  const denied = await accountManager();
  if (denied) return denied;
    const S = await schemas();
  const DUPLICATE = S.t.finance.err.duplicate;
  const aid = idSchema.safeParse(id);
  if (!aid.success) return { ok: false, message: S.t.finance.err.notFound };
  const v = S.accountUpdateSchema.safeParse(input); // no balance fields exist in this schema (stripped)
  if (!v.success) return collect(v.error.issues, S.t);
  const d = v.data;
  const existing = await db.cashBankAccount.findUnique({ where: { id: aid.data }, select: { id: true } });
    if (!existing) return { ok: false, message: S.t.finance.err.notFound };
  if (await db.cashBankAccount.findFirst({ where: { name: d.name, NOT: { id: existing.id } }, select: { id: true } })) return { ok: false, message: DUPLICATE, fieldErrors: { name: DUPLICATE } };
  try {
    // An account with an OPEN register session can't be deactivated or turned into a bank account.
    const blocked = await db.$transaction(async (tx) => {
      if (d.status === "INACTIVE" || d.type === "BANK") {
                const reg = await openRegisterBlock(tx, existing.id);
        if (reg) return tr(S.t, "finance.err.openRegister", { reference: reg });
      }
      await tx.cashBankAccount.update({
        where: { id: existing.id },
        data: { name: d.name, type: d.type, reference: d.reference || null, bankName: d.type === "BANK" ? d.bankName : null, status: d.status, notes: d.notes || null },
        select: { id: true },
      });
      return null;
    });
    if (blocked) return { ok: false, message: blocked };
  } catch (e) {
    if (isKnown(e, "P2002")) return { ok: false, message: DUPLICATE, fieldErrors: { name: DUPLICATE } };
    throw e;
  }
  revalidate();
  return { ok: true, message: S.t.finance.ok.updated };
}

export async function setAccountStatus(id: unknown, status: unknown): Promise<FinanceResult<AccountField>> {
  const denied = await accountManager();
  if (denied) return denied;
    const t = await getDict();
  const aid = idSchema.safeParse(id);
  const st = z.enum(["ACTIVE", "INACTIVE"]).safeParse(status);
  if (!aid.success || !st.success) return { ok: false, message: t.finance.err.invalidRequest };
  const res = await db.$transaction(async (tx) => {
    if (st.data === "INACTIVE") {
            const reg = await openRegisterBlock(tx, aid.data);
      if (reg) return tr(t, "finance.err.openRegister", { reference: reg });
    }
    return (await tx.cashBankAccount.updateMany({ where: { id: aid.data }, data: { status: st.data } })).count;
  });
  if (typeof res === "string") return { ok: false, message: res };
  if (res !== 1) return { ok: false, message: t.finance.err.notFound };
  revalidate();
  return { ok: true, message: st.data === "ACTIVE" ? t.finance.ok.activated : t.finance.ok.deactivated };
}

// ---- transactions (OWNER + ADMIN) -------------------------------------------------------------
// Locking, balance and chronology rules live in lib/cash-bank-ledger.ts (shared with Expenses).

async function recorder(): Promise<{ userId: string; t: Dictionary } | { error: FinanceResult<TxField> }> {
  const u = await session();
  const t = await getDict();
  if (!u) return { error: { ok: false, message: t.common.sessionExpired } };
  if (!canViewFinance(u) || !canRecordCashBankTransactions(u)) return { error: { ok: false, message: t.finance.err.noPermissionTx } };
  return { userId: u.id, t };
}

async function run(t: Dictionary, fn: (tx: Prisma.TransactionClient) => Promise<string>, success: (ref: string) => string): Promise<FinanceResult<TxField>> {
  try {
    const reference = await db.$transaction(fn, ledgerTxOptions);
    revalidate();
    return { ok: true, message: success(reference), reference };
  } catch (e) {
        if (e instanceof LedgerError) {
      const message = e.i18n ? tr(t, e.i18n.key, e.i18n.vars) : e.message;
      return { ok: false, message, fieldErrors: e.field ? { [e.field as TxField]: message } : undefined };
    }
    if (isKnown(e, "P2034")) return { ok: false, message: t.finance.err.busy };
    if (isKnown(e, "P2003")) return { ok: false, message: t.finance.err.accountGone };
    throw e;
  }
}

export async function createDeposit(input: unknown): Promise<FinanceResult<TxField>> {
  const a = await recorder();
  if ("error" in a) return a.error;
    const S = await schemas();
  const v = S.depositSchema.safeParse(input);
  if (!v.success) return collect(v.error.issues, S.t);
  const d = v.data;
  return run(S.t, async (tx) => {
    const acc = (await lockAccounts(tx, [d.accountId])).get(d.accountId) ?? ledgerFail("finance.err.invalidAccount", {}, "accountId");
    if (acc.status !== "ACTIVE") ledgerFail("finance.err.inactiveReceive", { name: acc.name }, "accountId");
    await assertChronology(tx, acc, dateOnly(d.transactionDate), new Prisma.Decimal(d.amount), { reveal: true }); // money in: always passes
    return (await appendLedgerRow(tx, "DEPOSIT", { transactionDate: dateOnly(d.transactionDate), accountId: acc.id, amount: d.amount, paymentMethod: d.paymentMethod, purpose: d.purpose, notes: d.notes || null, createdById: a.userId })).reference;
  }, (ref) => tr(S.t, "finance.ok.deposit", { ref }));
}

export async function createWithdrawal(input: unknown): Promise<FinanceResult<TxField>> {
  const a = await recorder();
  if ("error" in a) return a.error;
    const S = await schemas();
  const v = S.withdrawalSchema.safeParse(input);
  if (!v.success) return collect(v.error.issues, S.t);
  const d = v.data;
  return run(S.t, async (tx) => {
    const acc = (await lockAccounts(tx, [d.accountId])).get(d.accountId) ?? ledgerFail("finance.err.invalidAccount", {}, "accountId");
    if (acc.status !== "ACTIVE") ledgerFail("finance.err.inactiveReceive", { name: acc.name }, "accountId");
    await assertSufficient(tx, acc, d.amount, { reveal: true }); // under the row lock (finance.view is required to get here)
    await assertChronology(tx, acc, dateOnly(d.transactionDate), new Prisma.Decimal(d.amount).negated(), { reveal: true });
    return (await appendLedgerRow(tx, "WITHDRAWAL", { transactionDate: dateOnly(d.transactionDate), accountId: acc.id, amount: d.amount, paymentMethod: d.paymentMethod, purpose: d.purpose, notes: d.notes || null, createdById: a.userId })).reference;
  }, (ref) => tr(S.t, "finance.ok.withdrawal", { ref }));
}

export async function createTransfer(input: unknown): Promise<FinanceResult<TxField>> {
  const a = await recorder();
  if ("error" in a) return a.error;
    const S = await schemas();
  const v = S.transferSchema.safeParse(input);
  if (!v.success) return collect(v.error.issues, S.t);
  const d = v.data;
  return run(S.t, async (tx) => {
    const locked = await lockAccounts(tx, [d.fromAccountId, d.toAccountId]);
    const from = locked.get(d.fromAccountId) ?? ledgerFail("finance.err.invalidSource", {}, "fromAccountId");
    const to = locked.get(d.toAccountId) ?? ledgerFail("finance.err.invalidDestination", {}, "toAccountId");
    if (from.status !== "ACTIVE") ledgerFail("finance.err.inactiveUse", { name: from.name }, "fromAccountId");
    if (to.status !== "ACTIVE") ledgerFail("finance.err.inactiveReceive", { name: to.name }, "toAccountId");
    if (from.currencyId !== to.currencyId) ledgerFail("finance.err.sameCurrency", {}, "toAccountId");
    await assertSufficient(tx, from, d.amount, { reveal: true, label: from.name });
    // Both ledgers, chronologically: the source loses the amount at that date, the destination gains it.
    await assertChronology(tx, from, dateOnly(d.transactionDate), new Prisma.Decimal(d.amount).negated(), { reveal: true });
    await assertChronology(tx, to, dateOnly(d.transactionDate), new Prisma.Decimal(d.amount), { reveal: true });
    // One row = debit + credit together: the transfer can only ever apply exactly once.
    return (await appendLedgerRow(tx, "TRANSFER", { transactionDate: dateOnly(d.transactionDate), accountId: from.id, destinationAccountId: to.id, amount: d.amount, notes: d.notes || null, createdById: a.userId })).reference;
  }, (ref) => tr(S.t, "finance.ok.transfer", { ref }));
}