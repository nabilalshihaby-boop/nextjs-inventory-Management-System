"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { canManageTransfers } from "@/lib/roles";
import { formatQuantity } from "@/lib/money";
import { formatReference, makeTransferSchema, type TransferField, type TransferInput } from "@/lib/transfers";
import { getDict } from "@/lib/i18n/server";
import { errorMessage } from "@/lib/i18n/messages";
import { StockHistoryError, assertNonNegativeHistory } from "@/lib/stock-history-guard";
import { dayOfDateOnly } from "@/lib/inventory-reports";
import { fmt } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";

// Inventory Transfers. Integrity rules (all enforced here, server-side):
// - OWNER/ADMIN only; auth() is re-read in every action and the role never comes from the client.
// - Warehouses and products are looked up in MySQL; unit costs are snapshotted from Product.cost;
//   client-sent stock, cost, reference and status-transition data are never trusted.
// - Stock moves happen inside one transaction. The source is deducted with a conditional
//   UPDATE … WHERE quantity >= n (row-locked by InnoDB), so two transfers can't oversell the
//   same stock; status changes are conditional on the expected current status, so a stock
//   effect can never be applied twice (e.g. SENT → COMPLETED never deducts the source again).
// - PENDING: no stock change. SENT: deduct source. COMPLETED: deduct source (unless it was SENT)
//   and add to destination. Only PENDING transfers may be edited or deleted; SENT/COMPLETED are
//   inventory history. No sales, purchases, taxes, payments or ledger entries are created.

type Tx = Prisma.TransactionClient;

/** READ COMMITTED: the chronological history guard must read what the previous writer of the same stock rows committed. */
const stockTx = <T,>(fn: (tx: Tx) => Promise<T>) => db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });

export type TransferResult =
  | { ok: true; message: string; id?: string }
  | {
      ok: false;
      message: string;
      fieldErrors?: Partial<Record<TransferField, string>>;
      /** Per-line problems, keyed by product id. */
      itemErrors?: Record<string, string>;
    };

const idSchema = z.string().trim().min(1).max(64);

/** Thrown inside a transaction to roll it back when the source doesn't have enough stock. */
class StockError extends Error {
  constructor(
    readonly productId: string,
    readonly label: string,
  ) {
    super("insufficient stock");
  }
}
/** Thrown inside a transaction when the transfer's status is no longer the expected one. */
class StateError extends Error {}

async function authorize(t: Dictionary): Promise<{ userId: string } | { error: TransferResult }> {
  const session = await auth();
  if (!session?.user?.id) return { error: { ok: false, message: t.common.sessionExpired } };
  if (!canManageTransfers(session.user.role)) return { error: { ok: false, message: t.transfers.err.noPermission } };
  return { userId: session.user.id };
}

const isKnown = (e: unknown, ...codes: string[]): e is Prisma.PrismaClientKnownRequestError =>
  e instanceof Prisma.PrismaClientKnownRequestError && codes.includes(e.code);

function parse(input: unknown, t: Dictionary): { ok: true; data: TransferInput } | { ok: false; error: TransferResult } {
  const parsed = makeTransferSchema(t.transfers.val).safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: Partial<Record<TransferField, string>> = {};
  const itemErrors: Record<string, string> = {};
  const raw = (input && typeof input === "object" ? (input as { items?: unknown }).items : undefined) as { productId?: unknown }[] | undefined;
  for (const issue of parsed.error.issues) {
    const [k, index] = issue.path;
    if (k === "items" && typeof index === "number" && Array.isArray(raw) && typeof raw[index]?.productId === "string") {
      itemErrors[raw[index].productId as string] ??= issue.message;
      fieldErrors.items ??= issue.message;
    } else {
      fieldErrors[(k as TransferField) ?? "items"] ??= issue.message;
    }
  }
  return { ok: false, error: { ok: false, message: Object.values(fieldErrors)[0] ?? t.common.checkForm, fieldErrors, itemErrors } };
}

type Line = { productId: string; quantity: string; unitCost: string; label: string };

/**
 * Checks the payload against MySQL: both warehouses exist and products exist and have enough
 * stock in the source warehouse right now (friendly pre-check; the conditional update inside the
 * transaction is the real guarantee). Returns lines with server-side cost snapshots.
 */
async function resolve(data: TransferInput, t: Dictionary): Promise<{ ok: true; lines: Line[] } | { ok: false; error: TransferResult }> {
  const productIds = data.items.map((i) => i.productId);
  const [warehouses, products, stocks] = await Promise.all([
    db.warehouse.findMany({ where: { id: { in: [data.fromWarehouseId, data.toWarehouseId] } }, select: { id: true } }),
    db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, code: true, name: true, cost: true } }),
    db.productStock.findMany({ where: { warehouseId: data.fromWarehouseId, productId: { in: productIds } }, select: { productId: true, quantity: true } }),
  ]);
  const fieldErrors: Partial<Record<TransferField, string>> = {};
  const itemErrors: Record<string, string> = {};
  const wh = new Set(warehouses.map((w) => w.id));
  if (!wh.has(data.fromWarehouseId)) fieldErrors.fromWarehouseId = t.transfers.err.validSource;
  if (!wh.has(data.toWarehouseId)) fieldErrors.toWarehouseId = t.transfers.err.validDest;

  const byId = new Map(products.map((p) => [p.id, p]));
  const onHand = new Map(stocks.map((s) => [s.productId, s.quantity]));
  const lines: Line[] = [];
  for (const item of data.items) {
    const p = byId.get(item.productId);
    if (!p) {
      itemErrors[item.productId] = t.transfers.err.productGone;
      continue;
    }
    const available = onHand.get(p.id) ?? new Prisma.Decimal(0);
    if (new Prisma.Decimal(item.quantity).gt(available)) {
      itemErrors[p.id] = fmt(t.transfers.err.onlyAvailable, { qty: formatQuantity(available.toFixed(3)) });
    }
    lines.push({ productId: p.id, quantity: item.quantity, unitCost: p.cost.toFixed(2), label: `${p.code} ${p.name}` });
  }
  if (Object.keys(itemErrors).length) fieldErrors.items ??= Object.values(itemErrors)[0];
  if (Object.keys(fieldErrors).length) {
    return { ok: false, error: { ok: false, message: Object.values(fieldErrors)[0]!, fieldErrors, itemErrors } };
  }
  return { ok: true, lines };
}

/** Deduct each line from the source — only if enough stock is on hand at that instant. */
async function deductSource(tx: Tx, warehouseId: string, lines: Line[]) {
  // A stable lock order (by product id) avoids deadlocks between concurrent transfers.
  for (const l of [...lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
    const r = await tx.productStock.updateMany({
      where: { productId: l.productId, warehouseId, quantity: { gte: l.quantity } },
      data: { quantity: { decrement: l.quantity } },
    });
    if (r.count !== 1) throw new StockError(l.productId, l.label);
  }
}

async function addDestination(tx: Tx, warehouseId: string, lines: Line[]) {
  for (const l of [...lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
    await tx.productStock.upsert({
      where: { productId_warehouseId: { productId: l.productId, warehouseId } },
      create: { productId: l.productId, warehouseId, quantity: l.quantity },
      update: { quantity: { increment: l.quantity } },
    });
  }
}

/** Retry a transaction a few times on races (new destination stock row, write conflicts/deadlocks). */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt < 4 && isKnown(e, "P2002", "P2034")) continue;
      throw e;
    }
  }
}

function historyFailure(e: StockHistoryError, t: Dictionary): TransferResult {
  const message = errorMessage(t, e);
  return { ok: false, message, fieldErrors: { items: message }, itemErrors: e.itemId ? { [e.itemId]: message } : undefined };
}

function stockFailure(e: StockError, t: Dictionary): TransferResult {
  const message = fmt(t.transfers.err.notEnough, { label: e.label });
  return { ok: false, message, fieldErrors: { items: message }, itemErrors: { [e.productId]: message } };
}

function revalidate(id?: string) {
  revalidatePath("/transfers");
  if (id) revalidatePath(`/transfers/${id}`);
  revalidatePath("/products"); // "In Stock" totals
}

const statusDone = (t: Dictionary, status: "PENDING" | "SENT" | "COMPLETED", ref: string) =>
  fmt(status === "PENDING" ? t.transfers.ok.savedPending : status === "SENT" ? t.transfers.ok.sentNew : t.transfers.ok.completedNew, { ref });

export async function createTransfer(input: unknown): Promise<TransferResult> {
  const t = await getDict();
  const a = await authorize(t);
  if ("error" in a) return a.error;
  const v = parse(input, t);
  if (!v.ok) return v.error;
  const r = await resolve(v.data, t);
  if (!r.ok) return r.error;
  const d = v.data;

  try {
    const created = await withRetry(() =>
      stockTx(async (tx) => {
        // `number` comes from AUTO_INCREMENT (never reused); the reference is derived from it in the
        // same transaction, so the temporary placeholder is never visible outside it.
        const t0 = await tx.stockTransfer.create({
          data: {
            reference: `TMP_${randomBytes(8).toString("hex")}`,
            transferDate: new Date(`${d.transferDate}T00:00:00.000Z`),
            fromWarehouseId: d.fromWarehouseId,
            toWarehouseId: d.toWarehouseId,
            status: d.status,
            note: d.note || null,
            createdById: a.userId,
            items: { create: r.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitCost: l.unitCost })) },
          },
          select: { id: true, number: true, createdAt: true },
        });
        const tr = await tx.stockTransfer.update({ where: { id: t0.id }, data: { reference: formatReference(t0.number) }, select: { id: true, reference: true } });
        if (d.status === "SENT" || d.status === "COMPLETED") await deductSource(tx, d.fromWarehouseId, r.lines);
        if (d.status === "COMPLETED") await addDestination(tx, d.toWarehouseId, r.lines);
        // The transfer is dated d.transferDate (possibly in the past): its stock-out must keep the source history >= 0.
        if (d.status === "SENT" || d.status === "COMPLETED") await assertNonNegativeHistory(tx, r.lines.map((l) => ({ productId: l.productId, warehouseId: d.fromWarehouseId, day: d.transferDate, at: t0.createdAt.getTime() })));
        return tr;
      }),
    );
    revalidate(created.id);
    return { ok: true, message: statusDone(t, d.status, created.reference), id: created.id };
  } catch (e) {
    if (e instanceof StockHistoryError) return historyFailure(e, t);
    if (e instanceof StockError) return stockFailure(e, t);
    if (isKnown(e, "P2003")) return { ok: false, message: t.transfers.err.refsGone };
    throw e;
  }
}

/** Edit a PENDING transfer (details, lines and status). Its new status's stock effect is applied. */
export async function updateTransfer(id: unknown, input: unknown): Promise<TransferResult> {
  const t = await getDict();
  const E = t.transfers.err;
  const a = await authorize(t);
  if ("error" in a) return a.error;
  const tid = idSchema.safeParse(id);
  if (!tid.success) return { ok: false, message: E.notFound };
  const existing = await db.stockTransfer.findUnique({ where: { id: tid.data }, select: { id: true, status: true, reference: true, createdAt: true } });
  if (!existing) return { ok: false, message: E.notFound };
  if (existing.status !== "PENDING") return { ok: false, message: E.onlyPending };
  const v = parse(input, t);
  if (!v.ok) return v.error;
  const r = await resolve(v.data, t);
  if (!r.ok) return r.error;
  const d = v.data;

  try {
    await withRetry(() =>
      stockTx(async (tx) => {
        // Conditional on still being PENDING (a concurrent send/complete/delete wins).
        const u = await tx.stockTransfer.updateMany({
          where: { id: existing.id, status: "PENDING" },
          data: {
            transferDate: new Date(`${d.transferDate}T00:00:00.000Z`),
            fromWarehouseId: d.fromWarehouseId,
            toWarehouseId: d.toWarehouseId,
            status: d.status,
            note: d.note || null,
          },
        });
        if (u.count !== 1) throw new StateError();
        await tx.stockTransferItem.deleteMany({ where: { transferId: existing.id } });
        await tx.stockTransferItem.createMany({
          data: r.lines.map((l) => ({ transferId: existing.id, productId: l.productId, quantity: l.quantity, unitCost: l.unitCost })),
        });
        if (d.status === "SENT" || d.status === "COMPLETED") await deductSource(tx, d.fromWarehouseId, r.lines);
        if (d.status === "COMPLETED") await addDestination(tx, d.toWarehouseId, r.lines);
        if (d.status === "SENT" || d.status === "COMPLETED") await assertNonNegativeHistory(tx, r.lines.map((l) => ({ productId: l.productId, warehouseId: d.fromWarehouseId, day: d.transferDate, at: existing.createdAt.getTime() })));
      }),
    );
  } catch (e) {
    if (e instanceof StockHistoryError) return historyFailure(e, t);
    if (e instanceof StockError) return stockFailure(e, t);
    if (e instanceof StateError) return { ok: false, message: E.onlyPending };
    if (isKnown(e, "P2003")) return { ok: false, message: E.refsGone };
    throw e;
  }
  revalidate(existing.id);
  return { ok: true, message: d.status === "PENDING" ? fmt(t.transfers.ok.updated, { ref: existing.reference }) : statusDone(t, d.status, existing.reference), id: existing.id };
}

/** Lines of a transfer as stored (warehouses and quantities from MySQL, never from the client). */
async function loadLines(tx: Tx, transferId: string): Promise<Line[]> {
  const items = await tx.stockTransferItem.findMany({
    where: { transferId },
    select: { productId: true, quantity: true, unitCost: true, product: { select: { code: true, name: true } } },
  });
  return items.map((i) => ({ productId: i.productId, quantity: i.quantity.toFixed(3), unitCost: i.unitCost.toFixed(2), label: `${i.product.code} ${i.product.name}` }));
}

/** PENDING → SENT: deduct the source warehouse once. */
export async function sendTransfer(id: unknown): Promise<TransferResult> {
  const dict = await getDict();
  const E = dict.transfers.err;
  const a = await authorize(dict);
  if ("error" in a) return a.error;
  const tid = idSchema.safeParse(id);
  if (!tid.success) return { ok: false, message: E.notFound };
  const t = await db.stockTransfer.findUnique({ where: { id: tid.data }, select: { id: true, status: true, reference: true, fromWarehouseId: true, transferDate: true, createdAt: true } });
  if (!t) return { ok: false, message: E.notFound };
  if (t.status !== "PENDING") return { ok: false, message: fmt(E.onlySend, { status: dict.transfers.statusLower[t.status] }) };

  try {
    await stockTx(async (tx) => {
      const u = await tx.stockTransfer.updateMany({ where: { id: t.id, status: "PENDING" }, data: { status: "SENT" } });
      if (u.count !== 1) throw new StateError();
      const lines = await loadLines(tx, t.id);
      await deductSource(tx, t.fromWarehouseId, lines);
      await assertNonNegativeHistory(tx, lines.map((l) => ({ productId: l.productId, warehouseId: t.fromWarehouseId, day: dayOfDateOnly(t.transferDate), at: t.createdAt.getTime() })));
    });
  } catch (e) {
    if (e instanceof StockHistoryError) return historyFailure(e, dict);
    if (e instanceof StockError) return stockFailure(e, dict);
    if (e instanceof StateError) return { ok: false, message: E.changed };
    throw e;
  }
  revalidate(t.id);
  return { ok: true, message: fmt(dict.transfers.ok.sent, { ref: t.reference }) };
}

/** PENDING → COMPLETED (deduct source + add destination) or SENT → COMPLETED (add destination only). */
export async function completeTransfer(id: unknown): Promise<TransferResult> {
  const dict = await getDict();
  const E = dict.transfers.err;
  const a = await authorize(dict);
  if ("error" in a) return a.error;
  const tid = idSchema.safeParse(id);
  if (!tid.success) return { ok: false, message: E.notFound };
  const t = await db.stockTransfer.findUnique({
    where: { id: tid.data },
    select: { id: true, status: true, reference: true, fromWarehouseId: true, toWarehouseId: true, transferDate: true, createdAt: true },
  });
  if (!t) return { ok: false, message: E.notFound };
  if (t.status === "COMPLETED") return { ok: false, message: E.alreadyCompleted };
  const from = t.status; // PENDING or SENT

  try {
    await withRetry(() =>
      stockTx(async (tx) => {
        const u = await tx.stockTransfer.updateMany({ where: { id: t.id, status: from }, data: { status: "COMPLETED" } });
        if (u.count !== 1) throw new StateError();
        const lines = await loadLines(tx, t.id);
        if (from === "PENDING") await deductSource(tx, t.fromWarehouseId, lines); // SENT already deducted it
        await addDestination(tx, t.toWarehouseId, lines);
        // SENT → COMPLETED only ADDS stock (cannot lower any balance); PENDING → COMPLETED also takes the source stock out.
        if (from === "PENDING") await assertNonNegativeHistory(tx, lines.map((l) => ({ productId: l.productId, warehouseId: t.fromWarehouseId, day: dayOfDateOnly(t.transferDate), at: t.createdAt.getTime() })));
      }),
    );
  } catch (e) {
    if (e instanceof StockHistoryError) return historyFailure(e, dict);
    if (e instanceof StockError) return stockFailure(e, dict);
    if (e instanceof StateError) return { ok: false, message: E.changed };
    throw e;
  }
  revalidate(t.id);
  return { ok: true, message: fmt(dict.transfers.ok.completed, { ref: t.reference }) };
}

/** Delete a PENDING transfer (no stock was moved). SENT/COMPLETED are never deleted. */
export async function deleteTransfer(id: unknown): Promise<TransferResult> {
  const dict = await getDict();
  const E = dict.transfers.err;
  const a = await authorize(dict);
  if ("error" in a) return a.error;
  const tid = idSchema.safeParse(id);
  if (!tid.success) return { ok: false, message: E.notFound };
  const t = await db.stockTransfer.findUnique({ where: { id: tid.data }, select: { id: true, status: true, reference: true } });
  if (!t) return { ok: false, message: E.notFound };
  if (t.status !== "PENDING") return { ok: false, message: E.noDelete };

  // Conditional delete: refuses if it was sent/completed in the meantime. Items cascade.
  const r = await db.stockTransfer.deleteMany({ where: { id: t.id, status: "PENDING" } });
  if (r.count !== 1) return { ok: false, message: E.noDelete };
  revalidate();
  return { ok: true, message: fmt(dict.transfers.ok.deleted, { ref: t.reference }) };
}
