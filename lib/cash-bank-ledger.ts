// Server-only. The single implementation of the cash/bank ledger rules, shared by the Cash & Bank
// actions and the Expenses actions (so every money movement follows exactly the same rules):
// - account rows are locked (SELECT … FOR UPDATE, id order) and re-read inside the transaction;
// - balances are recomputed from committed ledger rows under that lock (no stored balance);
// - money out needs enough CURRENT balance and must not make the CHRONOLOGICAL running balance
//   negative at any point (backdating guard);
// - rows are appended with a server-generated, never-reused reference; nothing is edited/deleted.
import { randomBytes } from "node:crypto";
import { Prisma } from "@/app/generated/prisma/client";
import { computeBalances, findNegativeRunningBalance } from "@/lib/cash-bank-server";
import { formatDateOnly } from "@/lib/format";
import { tr } from "@/lib/i18n/messages";
import { en } from "@/lib/i18n/dictionaries/en";
import { formatMoney } from "@/lib/money";
import { getSystemSettings } from "@/lib/settings";
import { formatTxReference, type TxTypeValue } from "@/lib/cash-bank";

export type Tx = Prisma.TransactionClient;

/** Thrown inside a ledger transaction to roll it back with a user-facing message (and field). */
export class LedgerError extends Error {
  constructor(
    message: string,
    readonly field?: string,
    /** Optional dictionary key + values so localized modules can translate the message. */
    readonly i18n?: { key: string; vars: Record<string, string | number> },
  ) {
    super(message);
  }
}
export const ledgerReject = (message: string, field?: string, i18n?: { key: string; vars: Record<string, string | number> }): never => {
  throw new LedgerError(message, field, i18n);
};
/** Reject with a dictionary key: the English message is derived from en.ts (identical to before), the key lets localized callers translate it. */
export const ledgerFail = (key: string, vars: Record<string, string | number> = {}, field?: string): never => ledgerReject(tr(en, key, vars), field, { key, vars });

export type LockedAccount = { id: string; name: string; type: "CASH" | "BANK"; status: "ACTIVE" | "INACTIVE"; currencyId: string; currency: { symbol: string; code: string } };

/** Lock the account rows (id order → no deadlocks), then re-read them — current committed values. */
export async function lockAccounts(tx: Tx, ids: string[]): Promise<Map<string, LockedAccount>> {
  const sorted = [...new Set(ids)].sort();
  await tx.$queryRaw`SELECT id FROM cash_bank_accounts WHERE id IN (${Prisma.join(sorted)}) ORDER BY id FOR UPDATE`;
  const rows = await tx.cashBankAccount.findMany({ where: { id: { in: sorted } }, select: { id: true, name: true, type: true, status: true, currencyId: true, currency: { select: { symbol: true, code: true } } } });
  return new Map(rows.map((r) => [r.id, r]));
}

/** Append one ledger row with a server-generated, never-reused reference (AUTO_INCREMENT based). */
export async function appendLedgerRow(tx: Tx, type: TxTypeValue, data: Omit<Prisma.CashBankTransactionUncheckedCreateInput, "reference" | "type" | "number">) {
  const t0 = await tx.cashBankTransaction.create({ data: { ...data, type, reference: `TMP_${randomBytes(8).toString("hex")}` }, select: { id: true, number: true } });
  return tx.cashBankTransaction.update({ where: { id: t0.id }, data: { reference: formatTxReference(type, t0.number) }, select: { id: true, reference: true } });
}

export const moneyText = async (v: Prisma.Decimal, symbol: string) => formatMoney(v.toFixed(2), { code: "", symbol, right: !!(await getSystemSettings())?.currencyIconRight });

/** Current balance (from the ledger, read under the lock / inside the transaction). */
export async function balanceOf(tx: Tx, accountId: string): Promise<Prisma.Decimal> {
  return (await computeBalances(tx, [accountId])).get(accountId) ?? new Prisma.Decimal(0);
}

/** Money out must be covered by the current balance. */
export async function assertSufficient(tx: Tx, acc: LockedAccount, amount: Prisma.Decimal | string, field = "amount", label?: string) {
  const balance = await balanceOf(tx, acc.id);
  if (balance.lt(amount)) {
    const bal = await moneyText(balance, acc.currency.symbol);
    ledgerReject(label ? `Insufficient balance in ${acc.name} (${bal} available)` : `Insufficient balance (${bal} available)`, field, label ? { key: "finance.err.insufficientNamed", vars: { account: acc.name, balance: bal } } : { key: "finance.err.insufficient", vars: { balance: bal } });
  }
}

/**
 * Backdating guard: reject if, with a row of `delta` inserted at `date`, the account's
 * chronological running balance would go negative at any point.
 */
export async function assertChronology(tx: Tx, acc: LockedAccount, date: Date, delta: Prisma.Decimal, field = "transactionDate") {
  const hit = await findNegativeRunningBalance(tx, acc.id, { date, delta });
  if (!hit) return;
  const on = formatDateOnly(hit.date, (await getSystemSettings())?.dateFormat);
  const bal = await moneyText(hit.balance, acc.currency.symbol);
  ledgerReject(`This date would make the account balance negative: ${acc.name} would drop to ${bal} on ${on}.`, field, { key: "finance.err.chronology", vars: { account: acc.name, balance: bal, date: on } });
}

export const ledgerTxOptions = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 } as const;
export const dateOnly = (v: string) => new Date(`${v}T00:00:00.000Z`);
