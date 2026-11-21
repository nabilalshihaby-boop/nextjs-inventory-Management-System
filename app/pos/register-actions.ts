"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { LedgerError, appendLedgerRow, assertChronology, assertSufficient, dateOnly, ledgerTxOptions, lockAccounts } from "@/lib/cash-bank-ledger";
import { todayLocal } from "@/lib/cash-bank";
import { MOVEMENT_LABEL, closeRegisterSchema, formatMovementReference, formatRegisterReference, openRegisterSchema, registerMovementSchema, type RegisterOverview } from "@/lib/register";
import { getRegisterOverview } from "@/lib/register-data";
import { canUsePos } from "@/lib/roles";
import { getDefaultCurrency } from "@/lib/settings";

// Register sessions (cash-drawer shifts). NOT an accounting system:
// - Opening/closing writes ONLY cash_register_sessions: no ledger row, sale, payment, stock change or
//   account-balance change. The whole-account balance is never used.
// - Lock order everywhere: cash account row -> session row (checkout, Cash In/Out and Close all follow it).
// - Expected Cash = opening cash + Σ POS CASH tenders (customer payments) linked to THIS session
//   + Σ Cash In - Σ Cash Out register movements, recomputed on the server at close and cross-checked
//   against their linked ledger deposits / transfers. Cash In/Out are real balanced internal TRANSFERS.
// - OWNER/ADMIN only; auth() is re-read in every action. Status, expected, difference, the user and
//   the account type are never taken from the client (strict Zod payloads).
// - One OPEN session per account: the account row is locked, and openAccountKey is UNIQUE (the
//   account id while OPEN, NULL after close). Close locks the session row; checkout locks it too, so
//   a checkout can never attach a tender to a session that is closing/closed (and vice versa).
// - A closed session is immutable: no reopen, edit, delete or second close.

export type RegisterResult = ({ ok: true; message: string } & RegisterOverview) | { ok: false; message: string; fieldErrors?: Record<string, string> };

const isKnown = (e: unknown, ...codes: string[]) => e instanceof Prisma.PrismaClientKnownRequestError && codes.includes(e.code);
const reject = (message: string, field?: string): never => {
  throw new LedgerError(message, field);
};

async function authorize(): Promise<{ userId: string } | { error: { ok: false; message: string } }> {
  const s = await auth();
  if (!s?.user?.id) return { error: { ok: false, message: "Your session has expired. Please sign in again." } };
  if (!canUsePos(s.user.role)) return { error: { ok: false, message: "You don't have permission to use the POS." } };
  return { userId: s.user.id };
}

function invalid(error: { issues: { path: PropertyKey[]; code: string; message: string }[] }) {
  const fieldErrors: Record<string, string> = {};
  for (const i of error.issues) fieldErrors[String(i.path[0] ?? "form")] ??= i.code === "unrecognized_keys" ? "Unexpected fields were sent" : i.message;
  return { ok: false as const, message: Object.values(fieldErrors)[0] ?? "Please check the form", fieldErrors };
}

export async function getRegisters(): Promise<RegisterResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  return { ok: true, message: "", ...(await getRegisterOverview()) };
}

export async function openRegister(input: unknown): Promise<RegisterResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const v = openRegisterSchema.safeParse(input);
  if (!v.success) return invalid(v.error);
  const d = v.data;
  const currency = await getDefaultCurrency();
  if (!currency) return { ok: false, message: "No default currency is configured." };

  try {
    const created = await db.$transaction(async (tx) => {
      const acc = (await lockAccounts(tx, [d.cashBankAccountId])).get(d.cashBankAccountId) ?? reject("Choose a valid cash account", "cashBankAccountId");
      if (acc.type !== "CASH") reject(`${acc.name} is a bank account. Registers track physical cash drawers, so choose a Cash account.`, "cashBankAccountId");
      if (acc.status !== "ACTIVE") reject(`${acc.name} is inactive and can't open a register.`, "cashBankAccountId");
      if (acc.currencyId !== currency.id) reject(`${acc.name} uses a different currency from the POS sales.`, "cashBankAccountId");
      const open = await tx.cashRegisterSession.findFirst({ where: { cashBankAccountId: acc.id, status: "OPEN" }, select: { reference: true } });
      if (open) reject(`${acc.name} already has an open register (${open.reference}). Close it first.`, "cashBankAccountId");
      const s0 = await tx.cashRegisterSession.create({
        data: { reference: `TMP_${randomBytes(8).toString("hex")}`, cashBankAccountId: acc.id, status: "OPEN", openAccountKey: acc.id, openingCash: d.openingCash, openedById: a.userId, openingNotes: d.notes || null },
        select: { id: true, number: true },
      });
      const reference = formatRegisterReference(s0.number);
      await tx.cashRegisterSession.update({ where: { id: s0.id }, data: { reference } });
      return { reference, account: acc.name };
    }, ledgerTxOptions);
    revalidatePath("/pos");
    return { ok: true, message: `Register ${created.reference} opened on ${created.account}`, ...(await getRegisterOverview()) };
  } catch (e) {
    if (e instanceof LedgerError) return { ok: false, message: e.message, fieldErrors: e.field ? { [e.field]: e.message } : undefined };
    if (isKnown(e, "P2002")) return { ok: false, message: "That account already has an open register.", fieldErrors: { cashBankAccountId: "That account already has an open register." } };
    throw e;
  }
}

export async function closeRegister(input: unknown): Promise<RegisterResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const v = closeRegisterSchema.safeParse(input);
  if (!v.success) return invalid(v.error);
  const d = v.data;

  for (let attempt = 1; ; attempt++) {
  try {
    const closed = await db.$transaction(async (tx) => {
      // Lock the session row: a concurrent POS checkout (which locks it too) either finished before
      // we count, or runs after and sees the session closed.
      // Same lock order as checkout and Cash In/Out: the cash account row first, then the session row
      // (the session row references the account, so locking in the other order can deadlock).
      const pre = await tx.cashRegisterSession.findUnique({ where: { id: d.sessionId }, select: { cashBankAccountId: true } });
      const lockedAcc = pre ? (await lockAccounts(tx, [pre.cashBankAccountId])).get(pre.cashBankAccountId) : undefined;
      await tx.$queryRaw`SELECT id FROM cash_register_sessions WHERE id = ${d.sessionId} FOR UPDATE`;
      const s = await tx.cashRegisterSession.findUnique({ where: { id: d.sessionId }, select: { id: true, reference: true, status: true, openingCash: true } });
      if (!s) return reject("Register session not found");
      if (s.status !== "OPEN") return reject(`Register ${s.reference} is already closed.`);

      // Re-read every linked CASH tender and its ledger deposit; they must agree.
      const tenders = await tx.customerPayment.findMany({ where: { registerSessionId: s.id, paymentMethod: "Cash" }, select: { id: true, amount: true } });
      const sales = tenders.reduce((n, t) => n.plus(t.amount), new Prisma.Decimal(0));
      const deposits = tenders.length ? await tx.cashBankTransaction.aggregate({ where: { customerPaymentId: { in: tenders.map((t) => t.id) }, type: "DEPOSIT" }, _sum: { amount: true }, _count: true }) : null;
      if (deposits && (deposits._count !== tenders.length || !(deposits._sum.amount ?? new Prisma.Decimal(0)).equals(sales))) return reject("The register's cash tenders don't match their ledger deposits. Nothing was closed — contact support.");

      // Register movements (Cash In/Out): each is a linked ledger TRANSFER that must agree with the movement row.
      const moves = await tx.cashRegisterMovement.findMany({ where: { sessionId: s.id }, select: { type: true, amount: true, transactionId: true } });
      const cashIn = moves.filter((x) => x.type === "CASH_IN").reduce((n, x) => n.plus(x.amount), new Prisma.Decimal(0));
      const cashOut = moves.filter((x) => x.type === "CASH_OUT").reduce((n, x) => n.plus(x.amount), new Prisma.Decimal(0));
      if (moves.length) {
        const tr = await tx.cashBankTransaction.aggregate({ where: { id: { in: moves.map((x) => x.transactionId) }, type: "TRANSFER" }, _sum: { amount: true }, _count: true });
        if (tr._count !== moves.length || !(tr._sum.amount ?? new Prisma.Decimal(0)).equals(cashIn.plus(cashOut))) return reject("The register cash movements do not match their ledger transfers. Nothing was closed - contact support.");
      }
      const expected = s.openingCash.plus(sales).plus(cashIn).minus(cashOut);
      // Actual cash: from denomination counts (server-side values) when the currency has active denominations,
      // otherwise the typed counted cash. A client-sent total is never trusted when denominations exist.
      const denoms = lockedAcc ? await tx.currencyDenomination.findMany({ where: { currencyId: lockedAcc.currencyId, active: true }, orderBy: { value: "desc" } }) : [];
      let actual: Prisma.Decimal;
      let snapshot: { denominationId: string; value: Prisma.Decimal; label: string | null; count: number; lineTotal: Prisma.Decimal }[] = [];
      if (denoms.length) {
        if (d.closingCash !== undefined) return reject("This currency has cash denominations: count them instead of typing a total.", "counts");
        if (!d.counts) return reject("Enter the count of each denomination.", "counts");
        const byId = new Map(denoms.map((x) => [x.id, x]));
        const seen = new Set<string>();
        for (const c of d.counts) {
          if (!byId.has(c.denominationId)) return reject("A denomination is unknown or inactive. Refresh the POS and count again.", "counts");
          if (seen.has(c.denominationId)) return reject("Each denomination can be counted only once.", "counts");
          seen.add(c.denominationId);
        }
        const countOf = new Map(d.counts.map((c) => [c.denominationId, c.count]));
        snapshot = denoms.map((x) => {
          const count = countOf.get(x.id) ?? 0;
          return { denominationId: x.id, value: x.value, label: x.label, count, lineTotal: x.value.times(count) };
        });
        actual = snapshot.reduce((n, l) => n.plus(l.lineTotal), new Prisma.Decimal(0));
        if (actual.gt("999999999999.99")) return reject("The counted total is too large.", "counts");
      } else {
        if (d.counts !== undefined) return reject("No cash denominations are configured for this currency. Type the counted cash instead.", "closingCash");
        if (d.closingCash === undefined) return reject("Counted cash is required", "closingCash");
        actual = new Prisma.Decimal(d.closingCash);
      }
      const difference = actual.minus(expected);
      if (!difference.isZero() && !d.notes) return reject(`The counted cash differs from the expected cash by ${difference.toFixed(2)}. Add a note explaining the difference.`, "notes");

      const r = await tx.cashRegisterSession.updateMany({
        where: { id: s.id, status: "OPEN" },
        data: { status: "CLOSED", openAccountKey: null, closedAt: new Date(), closedById: a.userId, closingCash: actual, expectedCash: expected, difference, closingNotes: d.notes || null },
      });
      if (r.count !== 1) return reject(`Register ${s.reference} is already closed.`);
      // Immutable cash-count snapshot (values/labels copied: later denomination edits never change it).
      if (snapshot.length) await tx.cashRegisterCount.createMany({ data: snapshot.map((l) => ({ sessionId: s.id, denominationId: l.denominationId, value: l.value, label: l.label, count: l.count, lineTotal: l.lineTotal })) });
      return { reference: s.reference, expected, difference, id: s.id };
    }, ledgerTxOptions);
    revalidatePath("/pos");
    return { ok: true, message: `Register ${closed.reference} closed — expected ${closed.expected.toFixed(2)}, difference ${closed.difference.toFixed(2)}`, ...(await getRegisterOverview()) };
  } catch (e) {
    if (e instanceof LedgerError) return { ok: false, message: e.message, fieldErrors: e.field ? { [e.field]: e.message } : undefined };
    if (attempt < 4 && isKnown(e, "P2034")) continue; // deadlock / write conflict -> retry
    throw e;
  }
  }
}

/**
 * Cash In / Cash Out on an OPEN register: a real balanced internal TRANSFER between the register CASH
 * account and a counter-account, plus the immutable movement row linking to it - ONE transaction.
 * Lock order = checkout: accounts (id order) -> session row. Close Register locks only the session row,
 * so there is no cycle, and a movement can never attach to a session that is closing/closed.
 * The date is server "today" (no backdating); balances, status, user and reference are server-owned.
 */
export async function recordRegisterMovement(input: unknown): Promise<RegisterResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const v = registerMovementSchema.safeParse(input);
  if (!v.success) return invalid(v.error);
  const d = v.data;

  for (let attempt = 1; ; attempt++) {
    try {
      const done = await db.$transaction(async (tx) => {
        const pre = await tx.cashRegisterSession.findUnique({ where: { id: d.sessionId }, select: { cashBankAccountId: true } });
        if (!pre) return reject("Register session not found");
        if (pre.cashBankAccountId === d.counterAccountId) return reject("Choose a different account from the cash account of this register.", "counterAccountId");
        const accounts = await lockAccounts(tx, [pre.cashBankAccountId, d.counterAccountId]);
        await tx.$queryRaw`SELECT id FROM cash_register_sessions WHERE id = ${d.sessionId} FOR UPDATE`;
        const s = await tx.cashRegisterSession.findUnique({ where: { id: d.sessionId }, select: { id: true, reference: true, status: true, cashBankAccountId: true } });
        if (!s) return reject("Register session not found");
        if (s.status !== "OPEN") return reject(`Register ${s.reference} is closed. Cash movements need an open register.`);
        if (s.cashBankAccountId !== pre.cashBankAccountId) return reject("The register changed. Refresh and try again.");
        const reg = accounts.get(s.cashBankAccountId) ?? reject("Register account not found");
        const counter = accounts.get(d.counterAccountId) ?? reject("Choose a valid account", "counterAccountId");
        if (reg.type !== "CASH") reject(`${reg.name} is not a Cash account.`);
        if (reg.status !== "ACTIVE") reject(`${reg.name} is inactive.`);
        if (counter.status !== "ACTIVE") reject(`${counter.name} is inactive and cannot be used for new transactions.`, "counterAccountId");
        if (counter.currencyId !== reg.currencyId) reject("Both accounts must use the same currency.", "counterAccountId");
        const from = d.type === "CASH_IN" ? counter : reg;
        const to = d.type === "CASH_IN" ? reg : counter;
        const today = dateOnly(todayLocal());
        // Existing transfer rules: the source cannot be overdrawn now or at any later point of its ledger.
        await assertSufficient(tx, from, d.amount, "amount", from.name);
        await assertChronology(tx, from, today, new Prisma.Decimal(d.amount).negated(), "amount");
        await assertChronology(tx, to, today, new Prisma.Decimal(d.amount), "amount");
        const note = `${MOVEMENT_LABEL[d.type]} · ${s.reference} · ${d.notes}`;
        const transfer = await appendLedgerRow(tx, "TRANSFER", { transactionDate: today, accountId: from.id, destinationAccountId: to.id, amount: d.amount, notes: note, createdById: a.userId });
        const mv = await tx.cashRegisterMovement.create({
          data: { reference: `TMP_${randomBytes(8).toString("hex")}`, sessionId: s.id, type: d.type, amount: d.amount, fromAccountId: from.id, toAccountId: to.id, transactionId: transfer.id, notes: d.notes, createdById: a.userId },
          select: { id: true, number: true },
        });
        const reference = formatMovementReference(mv.number);
        await tx.cashRegisterMovement.update({ where: { id: mv.id }, data: { reference } });
        return { reference, transfer: transfer.reference, type: d.type };
      }, ledgerTxOptions);
      revalidatePath("/pos");
      revalidatePath("/finance/accounts");
      revalidatePath("/finance/transactions");
      return { ok: true, message: `${MOVEMENT_LABEL[done.type]} ${done.reference} recorded (${done.transfer})`, ...(await getRegisterOverview()) };
    } catch (e) {
      if (e instanceof LedgerError) return { ok: false, message: e.message, fieldErrors: e.field ? { [e.field]: e.message } : undefined };
      if (attempt < 4 && isKnown(e, "P2034")) continue; // deadlock / write conflict -> retry
      throw e;
    }
  }
}
