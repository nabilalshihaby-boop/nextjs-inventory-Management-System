// Server-only loaders for the Finance pages (OWNER/ADMIN — callers check the role first).
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { computeBalances } from "@/lib/cash-bank-server";
import { formatDateOnly } from "@/lib/format";
import { getDefaultCurrency, getSystemSettings } from "@/lib/settings";
import type { AccountOption, AccountRow, CurrencyView, TxRow, TxTypeValue } from "@/lib/cash-bank";

const time = (d: Date) => {
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const describe = (t: { type: TxTypeValue; purpose: string | null; notes: string | null }) =>
  t.type === "TRANSFER" ? t.notes || "Transfer between accounts" : [t.purpose, t.notes].filter(Boolean).join(" · ") || (t.type === "DEPOSIT" ? "Deposit" : "Withdrawal");

async function base() {
  const [settings, defaultCurrency] = await Promise.all([getSystemSettings(), getDefaultCurrency()]);
  const right = !!settings?.currencyIconRight;
  const view = (c: { code: string; symbol: string; name: string }): CurrencyView => ({ code: c.code, symbol: c.symbol, name: c.name, right });
  const dc = defaultCurrency ? await db.currency.findUnique({ where: { id: defaultCurrency.id }, select: { id: true, code: true, symbol: true, name: true } }) : null;
  return { dateFormat: settings?.dateFormat, view, defaultCurrency: dc ? { id: dc.id, ...view(dc) } : null };
}

export async function getAccountsView(): Promise<{ accounts: AccountRow[]; defaultCurrency: (CurrencyView & { id: string }) | null }> {
  const { dateFormat, view, defaultCurrency } = await base();
  const accounts = await db.cashBankAccount.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }], include: { currency: { select: { id: true, code: true, symbol: true, name: true } } } });
  const balances = await computeBalances(db, accounts.map((a) => a.id));
  const recent = await Promise.all(
    accounts.map((a) =>
      db.cashBankTransaction.findMany({
        where: { OR: [{ accountId: a.id }, { destinationAccountId: a.id }] },
        orderBy: [{ transactionDate: "desc" }, { number: "desc" }],
        take: 6,
        select: { reference: true, transactionDate: true, type: true, accountId: true, amount: true, purpose: true, notes: true, account: { select: { name: true } }, destinationAccount: { select: { name: true } } },
      }),
    ),
  );
  return {
    defaultCurrency,
    accounts: accounts.map((a, i) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      reference: a.reference ?? "",
      bankName: a.bankName ?? "",
      status: a.status,
      notes: a.notes ?? "",
      balance: (balances.get(a.id) ?? new Prisma.Decimal(0)).toFixed(2),
      openingBalance: a.openingBalance.toFixed(2),
      currency: view(a.currency),
      inDefaultCurrency: !!defaultCurrency && a.currencyId === defaultCurrency.id,
      recent: recent[i].map((t) => {
        const out = t.type === "WITHDRAWAL" || (t.type === "TRANSFER" && t.accountId === a.id);
        return {
          date: formatDateOnly(t.transactionDate, dateFormat),
          description: t.type === "TRANSFER" ? (out ? `Transfer to ${t.destinationAccount?.name}` : `Transfer from ${t.account.name}`) : describe(t),
          reference: t.reference,
          direction: out ? "out" : "in",
          amount: t.amount.toFixed(2),
        };
      }),
    })),
  };
}

/** The whole ledger with running balances (per account, by date then entry order). */
export async function getLedgerView(): Promise<{ rows: TxRow[]; accounts: AccountOption[]; defaultCurrency: (CurrencyView & { id: string }) | null }> {
  const { dateFormat, view, defaultCurrency } = await base();
  const [accounts, txs] = await Promise.all([
    db.cashBankAccount.findMany({ orderBy: { name: "asc" }, include: { currency: { select: { code: true, symbol: true, name: true } } } }),
    db.cashBankTransaction.findMany({ orderBy: [{ transactionDate: "asc" }, { number: "asc" }] }),
  ]);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const running = new Map(accounts.map((a) => [a.id, new Prisma.Decimal(a.openingBalance)]));
  const rows: TxRow[] = txs.map((t) => {
    const src = byId.get(t.accountId)!;
    const dst = t.destinationAccountId ? byId.get(t.destinationAccountId)! : null;
    const amt = new Prisma.Decimal(t.amount);
    const after = t.type === "DEPOSIT" ? running.get(src.id)!.plus(amt) : running.get(src.id)!.minus(amt);
    running.set(src.id, after);
    let toAfter: Prisma.Decimal | null = null;
    if (dst) {
      toAfter = running.get(dst.id)!.plus(amt);
      running.set(dst.id, toAfter);
    }
    return {
      id: t.id,
      number: t.number,
      reference: t.reference,
      date: t.transactionDate.toISOString().slice(0, 10),
      when: `${formatDateOnly(t.transactionDate, dateFormat)} · ${time(t.createdAt)}`,
      type: t.type,
      accountId: src.id,
      accountName: src.name,
      toAccountId: dst?.id ?? null,
      toAccountName: dst?.name ?? null,
      description: describe(t),
      amount: amt.toFixed(2),
      moneyIn: t.type === "DEPOSIT" ? amt.toFixed(2) : null,
      moneyOut: t.type === "WITHDRAWAL" ? amt.toFixed(2) : null,
      balanceAfter: after.toFixed(2),
      toBalanceAfter: toAfter?.toFixed(2) ?? null,
      paymentMethod: t.paymentMethod ?? "",
      purpose: t.purpose ?? "",
      notes: t.notes ?? "",
      currency: view(src.currency),
    };
  });
  return {
    rows,
    defaultCurrency,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, active: a.status === "ACTIVE", balance: (running.get(a.id) ?? new Prisma.Decimal(0)).toFixed(2), currencyId: a.currencyId, currency: view(a.currency) })),
  };
}
