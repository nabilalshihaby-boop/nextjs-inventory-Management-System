// Server-only loaders for register sessions (OWNER/ADMIN - callers check the role first).
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { getDict, getLocale } from "@/lib/i18n/server";
import { fullName } from "@/lib/actor-name";
import { getSystemSettings } from "@/lib/settings";
import type { OpenRegister, RegisterHistoryRow, RegisterMovementRow, RegisterOverview } from "@/lib/register";

const D0 = new Prisma.Decimal(0);
export type SessionTotals = { cashSales: Prisma.Decimal; cashIn: Prisma.Decimal; cashOut: Prisma.Decimal };

/**
 * Per session: Σ POS CASH tenders linked to it, Σ Cash In and Σ Cash Out register movements.
 * Expected Cash = opening + cashSales + cashIn - cashOut (nothing else is ever added).
 */
export async function totalsBySession(ids: string[]): Promise<Map<string, SessionTotals>> {
  const out = new Map<string, SessionTotals>(ids.map((id) => [id, { cashSales: D0, cashIn: D0, cashOut: D0 }]));
  if (!ids.length) return out;
  const [sales, moves] = await Promise.all([
    db.customerPayment.groupBy({ by: ["registerSessionId"], where: { registerSessionId: { in: ids }, paymentMethod: "Cash" }, _sum: { amount: true } }),
    db.cashRegisterMovement.groupBy({ by: ["sessionId", "type"], where: { sessionId: { in: ids } }, _sum: { amount: true } }),
  ]);
  for (const r of sales) out.get(r.registerSessionId as string)!.cashSales = r._sum.amount ?? D0;
  for (const r of moves) out.get(r.sessionId)![r.type === "CASH_IN" ? "cashIn" : "cashOut"] = r._sum.amount ?? D0;
  return out;
}
export const expectedOf = (opening: Prisma.Decimal, t: SessionTotals) => opening.plus(t.cashSales).plus(t.cashIn).minus(t.cashOut);

export async function getRegisterOverview(): Promise<RegisterOverview> {
  const locale = await getLocale();
  const [sessions, settings] = await Promise.all([
    db.cashRegisterSession.findMany({ orderBy: { number: "desc" }, take: 60, include: { cashBankAccount: { select: { name: true } } } }),
    getSystemSettings(),
  ]);
  const moves = await db.cashRegisterMovement.findMany({
    where: { sessionId: { in: sessions.map((s) => s.id) } },
    orderBy: { number: "desc" },
    take: 120,
    include: { session: { select: { reference: true } }, fromAccount: { select: { name: true } }, toAccount: { select: { name: true } }, transaction: { select: { reference: true } } },
  });
  const userIds = [...new Set([...sessions.flatMap((s) => [s.openedById, s.closedById]), ...moves.map((x) => x.createdById)].filter((x): x is string => !!x))];
  const users = new Map((await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } })).map((u) => [u.id, fullName(u)]));
  const totals = await totalsBySession(sessions.map((s) => s.id));
  // The stored snapshot wins; the live name only serves rows that have none.
  const former = (await getDict()).registerReport.formerUser;
  const name = (uid: string | null, snapshot: string | null) => snapshot ?? (uid ? (users.get(uid) ?? former) : "—");
  const fmt = (d: Date) => formatDateTime(d, settings?.dateFormat, locale);
  const open: OpenRegister[] = [];
  const history: RegisterHistoryRow[] = [];
  for (const s of sessions) {
    const t = totals.get(s.id)!;
    const live = expectedOf(s.openingCash, t);
    if (s.status === "OPEN") {
      open.push({ id: s.id, reference: s.reference, accountId: s.cashBankAccountId, accountName: s.cashBankAccount.name, openingCash: s.openingCash.toFixed(2), cashSales: t.cashSales.toFixed(2), cashIn: t.cashIn.toFixed(2), cashOut: t.cashOut.toFixed(2), expected: live.toFixed(2), openedAt: fmt(s.openedAt), openedBy: name(s.openedById, s.openedByName) });
    }
    history.push({
      id: s.id,
      reference: s.reference,
      accountName: s.cashBankAccount.name,
      status: s.status,
      openedBy: name(s.openedById, s.openedByName),
      openedAt: fmt(s.openedAt),
      closedAt: s.closedAt ? fmt(s.closedAt) : null,
      openingCash: s.openingCash.toFixed(2),
      expected: (s.status === "CLOSED" ? (s.expectedCash ?? live) : live).toFixed(2),
      actual: s.closingCash ? s.closingCash.toFixed(2) : null,
      difference: s.difference ? s.difference.toFixed(2) : null,
    });
  }
  const movements: RegisterMovementRow[] = moves.map((x) => ({
    id: x.id,
    reference: x.reference,
    sessionId: x.sessionId,
    sessionReference: x.session.reference,
    type: x.type,
    at: fmt(x.createdAt),
    from: x.fromAccount.name,
    to: x.toAccount.name,
    amount: x.amount.toFixed(2),
    notes: x.notes,
    user: name(x.createdById, x.createdByName),
    transferReference: x.transaction.reference,
  }));
  return { open, history, movements };
}
