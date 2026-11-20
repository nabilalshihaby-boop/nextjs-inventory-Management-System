"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { LedgerError, appendLedgerRow, assertChronology, assertSufficient, dateOnly, ledgerReject, ledgerTxOptions, lockAccounts } from "@/lib/cash-bank-ledger";
import { canManageCashBankAccounts, canRecordCashBankTransactions } from "@/lib/roles";
import { getDefaultCurrency } from "@/lib/settings";
import {
  accountCreateSchema,
  accountUpdateSchema,
  depositSchema,
  transferSchema,
  withdrawalSchema,
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
const DUPLICATE = "An account with this name already exists";
const NO_CURRENCY = "No default currency is configured. The Owner must choose one in System Settings (/settings) before cash & bank accounts can be created.";

async function session() {
  const s = await auth();
  return s?.user?.id ? s.user : null;
}

function collect<F extends string>(issues: z.core.$ZodIssue[]): FinanceResult<F> {
  const fieldErrors: Partial<Record<F, string>> = {};
  for (const i of issues) fieldErrors[i.path[0] as F] ??= i.message;
  return { ok: false, message: Object.values<string | undefined>(fieldErrors)[0] ?? "Please check the form", fieldErrors };
}
const isKnown = (e: unknown, ...codes: string[]) => e instanceof Prisma.PrismaClientKnownRequestError && codes.includes(e.code);
const revalidate = () => {
  revalidatePath("/finance/accounts");
  revalidatePath("/finance/transactions");
};

// ---- accounts (OWNER + ADMIN) ------------------------------------------------------------------

async function accountManager(): Promise<FinanceResult<AccountField> | null> {
  const u = await session();
  if (!u) return { ok: false, message: "Your session has expired. Please sign in again." };
  if (!canManageCashBankAccounts(u.role)) return { ok: false, message: "You don't have permission to create or change cash & bank accounts." };
  return null;
}

export async function createAccount(input: unknown): Promise<FinanceResult<AccountField>> {
  const denied = await accountManager();
  if (denied) return denied;
  const currency = await getDefaultCurrency(); // the account currency is always the default currency
  if (!currency) return { ok: false, message: NO_CURRENCY, fieldErrors: { currency: NO_CURRENCY } };
  const v = accountCreateSchema.safeParse(input);
  if (!v.success) return collect(v.error.issues);
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
  return { ok: true, message: "Account created" };
}

/** Edit account details. Opening balance, currency and the (computed) balance can't be changed. */
export async function updateAccount(id: unknown, input: unknown): Promise<FinanceResult<AccountField>> {
  const denied = await accountManager();
  if (denied) return denied;
  const aid = idSchema.safeParse(id);
  if (!aid.success) return { ok: false, message: "Account not found" };
  const v = accountUpdateSchema.safeParse(input); // no balance fields exist in this schema (stripped)
  if (!v.success) return collect(v.error.issues);
  const d = v.data;
  const existing = await db.cashBankAccount.findUnique({ where: { id: aid.data }, select: { id: true } });
  if (!existing) return { ok: false, message: "Account not found" };
  if (await db.cashBankAccount.findFirst({ where: { name: d.name, NOT: { id: existing.id } }, select: { id: true } })) return { ok: false, message: DUPLICATE, fieldErrors: { name: DUPLICATE } };
  try {
    await db.cashBankAccount.update({
      where: { id: existing.id },
      data: { name: d.name, type: d.type, reference: d.reference || null, bankName: d.type === "BANK" ? d.bankName : null, status: d.status, notes: d.notes || null },
      select: { id: true },
    });
  } catch (e) {
    if (isKnown(e, "P2002")) return { ok: false, message: DUPLICATE, fieldErrors: { name: DUPLICATE } };
    throw e;
  }
  revalidate();
  return { ok: true, message: "Account updated" };
}

export async function setAccountStatus(id: unknown, status: unknown): Promise<FinanceResult<AccountField>> {
  const denied = await accountManager();
  if (denied) return denied;
  const aid = idSchema.safeParse(id);
  const st = z.enum(["ACTIVE", "INACTIVE"]).safeParse(status);
  if (!aid.success || !st.success) return { ok: false, message: "Invalid request" };
  const r = await db.cashBankAccount.updateMany({ where: { id: aid.data }, data: { status: st.data } });
  if (r.count !== 1) return { ok: false, message: "Account not found" };
  revalidate();
  return { ok: true, message: st.data === "ACTIVE" ? "Account activated" : "Account deactivated" };
}

// ---- transactions (OWNER + ADMIN) -------------------------------------------------------------
// Locking, balance and chronology rules live in lib/cash-bank-ledger.ts (shared with Expenses).

async function recorder(): Promise<{ userId: string } | { error: FinanceResult<TxField> }> {
  const u = await session();
  if (!u) return { error: { ok: false, message: "Your session has expired. Please sign in again." } };
  if (!canRecordCashBankTransactions(u.role)) return { error: { ok: false, message: "You don't have permission to record cash & bank transactions." } };
  return { userId: u.id };
}

async function run(fn: (tx: Prisma.TransactionClient) => Promise<string>, success: (ref: string) => string): Promise<FinanceResult<TxField>> {
  try {
    const reference = await db.$transaction(fn, ledgerTxOptions);
    revalidate();
    return { ok: true, message: success(reference), reference };
  } catch (e) {
    if (e instanceof LedgerError) return { ok: false, message: e.message, fieldErrors: e.field ? { [e.field as TxField]: e.message } : undefined };
    if (isKnown(e, "P2034")) return { ok: false, message: "The account was busy. Please try again." };
    if (isKnown(e, "P2003")) return { ok: false, message: "The account no longer exists. Refresh and try again." };
    throw e;
  }
}

export async function createDeposit(input: unknown): Promise<FinanceResult<TxField>> {
  const a = await recorder();
  if ("error" in a) return a.error;
  const v = depositSchema.safeParse(input);
  if (!v.success) return collect(v.error.issues);
  const d = v.data;
  return run(async (tx) => {
    const acc = (await lockAccounts(tx, [d.accountId])).get(d.accountId) ?? ledgerReject("Choose a valid account", "accountId");
    if (acc.status !== "ACTIVE") ledgerReject(`${acc.name} is inactive and can't receive new transactions.`, "accountId");
    await assertChronology(tx, acc, dateOnly(d.transactionDate), new Prisma.Decimal(d.amount)); // money in: always passes
    return (await appendLedgerRow(tx, "DEPOSIT", { transactionDate: dateOnly(d.transactionDate), accountId: acc.id, amount: d.amount, paymentMethod: d.paymentMethod, purpose: d.purpose, notes: d.notes || null, createdById: a.userId })).reference;
  }, (ref) => `Deposit ${ref} recorded`);
}

export async function createWithdrawal(input: unknown): Promise<FinanceResult<TxField>> {
  const a = await recorder();
  if ("error" in a) return a.error;
  const v = withdrawalSchema.safeParse(input);
  if (!v.success) return collect(v.error.issues);
  const d = v.data;
  return run(async (tx) => {
    const acc = (await lockAccounts(tx, [d.accountId])).get(d.accountId) ?? ledgerReject("Choose a valid account", "accountId");
    if (acc.status !== "ACTIVE") ledgerReject(`${acc.name} is inactive and can't receive new transactions.`, "accountId");
    await assertSufficient(tx, acc, d.amount); // under the row lock
    await assertChronology(tx, acc, dateOnly(d.transactionDate), new Prisma.Decimal(d.amount).negated());
    return (await appendLedgerRow(tx, "WITHDRAWAL", { transactionDate: dateOnly(d.transactionDate), accountId: acc.id, amount: d.amount, paymentMethod: d.paymentMethod, purpose: d.purpose, notes: d.notes || null, createdById: a.userId })).reference;
  }, (ref) => `Withdrawal ${ref} recorded`);
}

export async function createTransfer(input: unknown): Promise<FinanceResult<TxField>> {
  const a = await recorder();
  if ("error" in a) return a.error;
  const v = transferSchema.safeParse(input);
  if (!v.success) return collect(v.error.issues);
  const d = v.data;
  return run(async (tx) => {
    const locked = await lockAccounts(tx, [d.fromAccountId, d.toAccountId]);
    const from = locked.get(d.fromAccountId) ?? ledgerReject("Choose a valid source account", "fromAccountId");
    const to = locked.get(d.toAccountId) ?? ledgerReject("Choose a valid destination account", "toAccountId");
    if (from.status !== "ACTIVE") ledgerReject(`${from.name} is inactive and can't be used for new transactions.`, "fromAccountId");
    if (to.status !== "ACTIVE") ledgerReject(`${to.name} is inactive and can't receive new transactions.`, "toAccountId");
    if (from.currencyId !== to.currencyId) ledgerReject("Both accounts must use the same currency.", "toAccountId");
    await assertSufficient(tx, from, d.amount, "amount", from.name);
    // Both ledgers, chronologically: the source loses the amount at that date, the destination gains it.
    await assertChronology(tx, from, dateOnly(d.transactionDate), new Prisma.Decimal(d.amount).negated());
    await assertChronology(tx, to, dateOnly(d.transactionDate), new Prisma.Decimal(d.amount));
    // One row = debit + credit together: the transfer can only ever apply exactly once.
    return (await appendLedgerRow(tx, "TRANSFER", { transactionDate: dateOnly(d.transactionDate), accountId: from.id, destinationAccountId: to.id, amount: d.amount, notes: d.notes || null, createdById: a.userId })).reference;
  }, (ref) => `Transfer ${ref} recorded`);
}