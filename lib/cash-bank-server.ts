// Server-only Cash & Bank helpers. Balances are NEVER stored: they are computed from the ledger.
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";

type Client = Prisma.TransactionClient | typeof db;
const ZERO = () => new Prisma.Decimal(0);

/**
 * Chronological check for a prospective ledger row. The account's ledger is ordered exactly like
 * the transactions table (transactionDate, then entry number); the new row gets the next
 * AUTO_INCREMENT number, so it sorts after every existing row of the same date. Returns the first
 * point at or after the new row where the running balance would drop below zero, or null if the
 * whole prospective ledger stays ≥ 0 from there on. (Rows before the new one are unaffected by it.)
 * Call inside the transaction, after locking the account row.
 */
export async function findNegativeRunningBalance(
  client: Client,
  accountId: string,
  row: { date: Date; delta: Prisma.Decimal },
): Promise<{ date: Date; balance: Prisma.Decimal } | null> {
  if (!row.delta.isNegative()) return null; // money in can never create a negative point
  const [account, txs] = await Promise.all([
    client.cashBankAccount.findUnique({ where: { id: accountId }, select: { openingBalance: true } }),
    client.cashBankTransaction.findMany({
      where: { OR: [{ accountId }, { destinationAccountId: accountId }] },
      orderBy: [{ transactionDate: "asc" }, { number: "asc" }],
      select: { transactionDate: true, type: true, accountId: true, amount: true },
    }),
  ]);
  if (!account) return null;
  let balance = new Prisma.Decimal(account.openingBalance);
  let inserted = false;
  const step = (d: Date, delta: Prisma.Decimal) => {
    balance = balance.plus(delta);
    return inserted && balance.isNegative() ? { date: d, balance } : null;
  };
  for (const t of txs) {
    if (!inserted && t.transactionDate.getTime() > row.date.getTime()) {
      inserted = true;
      const hit = step(row.date, row.delta);
      if (hit) return hit;
    }
    const amt = new Prisma.Decimal(t.amount);
    const delta = t.type === "DEPOSIT" || (t.type === "TRANSFER" && t.accountId !== accountId) ? amt : amt.negated();
    const hit = step(t.transactionDate, delta);
    if (hit) return hit;
  }
  if (!inserted) {
    inserted = true;
    return step(row.date, row.delta);
  }
  return null;
}

/**
 * Current balance per account: openingBalance + deposits − withdrawals − transfers out + transfers in.
 * Pass the transaction client to read inside a locked transaction.
 */
export async function computeBalances(client: Client, accountIds?: string[]): Promise<Map<string, Prisma.Decimal>> {
  const where = accountIds ? { id: { in: accountIds } } : {};
  const [accounts, bySource, transfersIn] = await Promise.all([
    client.cashBankAccount.findMany({ where, select: { id: true, openingBalance: true } }),
    client.cashBankTransaction.groupBy({ by: ["accountId", "type"], where: accountIds ? { accountId: { in: accountIds } } : {}, _sum: { amount: true } }),
    client.cashBankTransaction.groupBy({
      by: ["destinationAccountId"],
      where: { type: "TRANSFER", ...(accountIds ? { destinationAccountId: { in: accountIds } } : { destinationAccountId: { not: null } }) },
      _sum: { amount: true },
    }),
  ]);
  const out = new Map(accounts.map((a) => [a.id, new Prisma.Decimal(a.openingBalance)]));
  for (const g of bySource) {
    const cur = out.get(g.accountId);
    if (!cur) continue;
    const amt = g._sum.amount ?? ZERO();
    out.set(g.accountId, g.type === "DEPOSIT" ? cur.plus(amt) : cur.minus(amt)); // WITHDRAWAL and TRANSFER out
  }
  for (const g of transfersIn) {
    if (!g.destinationAccountId) continue;
    const cur = out.get(g.destinationAccountId);
    if (cur) out.set(g.destinationAccountId, cur.plus(g._sum.amount ?? ZERO()));
  }
  return out;
}
