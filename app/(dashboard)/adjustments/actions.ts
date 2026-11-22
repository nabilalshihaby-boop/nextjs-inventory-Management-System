"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { canManageAdjustments } from "@/lib/roles";
import { formatQuantity } from "@/lib/money";
import { fromUnits } from "@/lib/transfers";
import { formatAdjustmentReference, makeAdjustmentSchema, signedUnits, type AdjustmentField, type AdjustmentInput, type AdjustmentTypeValue } from "@/lib/adjustments";
import { getDict } from "@/lib/i18n/server";
import { errorMessage, tr } from "@/lib/i18n/messages";
import { StockHistoryError, assertNonNegativeHistory } from "@/lib/stock-history-guard";
import { lineSnapshot, loadUnitSets, resolveLine, type ResolvedUnit } from "@/lib/product-units";
import { dayOfDateOnly } from "@/lib/inventory-reports";
import { fmt } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";

// Stock Adjustments. Integrity rules (all enforced here, server-side):
// - OWNER/ADMIN only; auth() is re-read in every action and the role never comes from the client.
// - The warehouse and products are looked up in MySQL. Current stock is read from MySQL inside
//   the transaction — client-sent stock values are never used.
// - Every create / edit / delete runs in ONE transaction that applies the NET stock effect per
//   product: create = +new, delete = −original, edit = new − original (the original effect is
//   reversed and the new one applied together). A decrease only happens through a conditional
//   UPDATE … WHERE quantity >= n, so stock can never go negative — a subtraction above stock, or
//   reversing an addition whose stock was already used, is rejected and the whole change rolls back.
// - The adjustment row is locked (SELECT … FOR UPDATE) before an edit/delete reads its original
//   items, so two concurrent edits/deletes can't reverse the same effect twice.

type Tx = Prisma.TransactionClient;

export type AdjustmentResult =
  | { ok: true; message: string; id?: string }
  | { ok: false; message: string; fieldErrors?: Partial<Record<AdjustmentField, string>>; itemErrors?: Record<string, string> };

const idSchema = z.string().trim().min(1).max(64);

class StockError extends Error {
  constructor(readonly productId: string, readonly label: string, readonly available: string, readonly needed: string) {
    super("insufficient stock");
  }
}
class GoneError extends Error {}

async function authorize(t: Dictionary): Promise<{ userId: string } | { error: AdjustmentResult }> {
  const session = await auth();
  if (!session?.user?.id) return { error: { ok: false, message: t.common.sessionExpired } };
  if (!canManageAdjustments(session.user.role)) return { error: { ok: false, message: t.adjustments.err.noPermission } };
  return { userId: session.user.id };
}

const isKnown = (e: unknown, ...codes: string[]) => e instanceof Prisma.PrismaClientKnownRequestError && codes.includes(e.code);

function parse(input: unknown, t: Dictionary): { ok: true; data: AdjustmentInput } | { ok: false; error: AdjustmentResult } {
  const parsed = makeAdjustmentSchema(t.adjustments.val).safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: Partial<Record<AdjustmentField, string>> = {};
  const itemErrors: Record<string, string> = {};
  const raw = (input && typeof input === "object" ? (input as { items?: unknown }).items : undefined) as { productId?: unknown }[] | undefined;
  for (const issue of parsed.error.issues) {
    const [k, index] = issue.path;
    if (k === "items" && typeof index === "number" && Array.isArray(raw) && typeof raw[index]?.productId === "string") {
      itemErrors[raw[index].productId as string] ??= issue.message;
    }
    fieldErrors[(k as AdjustmentField) ?? "items"] ??= issue.message;
  }
  return { ok: false, error: { ok: false, message: Object.values(fieldErrors)[0] ?? t.common.checkForm, fieldErrors, itemErrors } };
}

/** Warehouse and every product must exist in MySQL. Returns product labels for messages. */
async function resolve(d: AdjustmentInput, t: Dictionary): Promise<{ ok: true; labels: Map<string, string>; units: Map<string, ResolvedUnit> } | { ok: false; error: AdjustmentResult }> {
  const [warehouse, products] = await Promise.all([
    db.warehouse.findUnique({ where: { id: d.warehouseId }, select: { id: true } }),
    db.product.findMany({ where: { id: { in: d.items.map((i) => i.productId) } }, select: { id: true, code: true, name: true } }),
  ]);
  const fieldErrors: Partial<Record<AdjustmentField, string>> = {};
  const itemErrors: Record<string, string> = {};
  if (!warehouse) fieldErrors.warehouseId = t.adjustments.err.validWarehouse;
  const labels = new Map(products.map((p) => [p.id, `${p.code} ${p.name}`]));
  for (const i of d.items) if (!labels.has(i.productId)) itemErrors[i.productId] = t.adjustments.err.productGone;
  // Units: an active conversion of THIS product (blank = the base unit); stock moves by the exact BASE quantity.
  const sets = await loadUnitSets(db, d.items.map((i) => i.productId));
  const units = new Map<string, ResolvedUnit>();
  for (const i of d.items) {
    if (!labels.has(i.productId)) continue;
    const ru = resolveLine(sets.get(i.productId), i.unitId, "ANY", i.quantity, labels.get(i.productId)!);
    if (ru.ok) units.set(i.productId, ru.r);
    else itemErrors[i.productId] = tr(t, ru.f.key, ru.f.vars);
  }
  if (Object.keys(itemErrors).length) fieldErrors.items ??= Object.values(itemErrors)[0];
  if (Object.keys(fieldErrors).length) return { ok: false, error: { ok: false, message: Object.values(fieldErrors)[0]!, fieldErrors, itemErrors } };
  return { ok: true, labels, units };
}

/** READ COMMITTED: the chronological history guard must read what the previous writer of the same stock rows committed. */
const stockTx = <T,>(fn: (tx: Tx) => Promise<T>) => db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });

type Line = { productId: string; quantity: string; type: AdjustmentTypeValue };
/** Lines whose quantity is the BASE quantity (what stock changes by). */
const baseLines = (items: { productId: string; type: AdjustmentTypeValue }[], units: Map<string, ResolvedUnit>): Line[] => items.map((i) => ({ productId: i.productId, quantity: units.get(i.productId)!.baseQuantity, type: i.type }));
const itemData = (i: { productId: string; quantity: string; type: AdjustmentTypeValue }, units: Map<string, ResolvedUnit>) => ({ productId: i.productId, quantity: i.quantity, type: i.type, ...lineSnapshot(units.get(i.productId)!) });

type Deltas = Map<string, { productId: string; warehouseId: string; units: bigint }>;

function addEffect(m: Deltas, warehouseId: string, lines: Line[], sign: 1 | -1) {
  for (const l of lines) {
    const key = `${l.productId}|${warehouseId}`;
    const cur = m.get(key) ?? { productId: l.productId, warehouseId, units: BigInt(0) };
    cur.units += BigInt(sign) * signedUnits(l.quantity, l.type);
    m.set(key, cur);
  }
}

/** Apply net stock changes; decreases are conditional so stock never goes below zero. */
async function applyDeltas(tx: Tx, deltas: Deltas, labels: Map<string, string>, aProduct: string) {
  // Stable lock order (product|warehouse) avoids deadlocks between concurrent adjustments.
  for (const [, d] of [...deltas].sort(([a], [b]) => a.localeCompare(b))) {
    if (d.units === BigInt(0)) continue;
    const qty = fromUnits(d.units < BigInt(0) ? -d.units : d.units, 3);
    if (d.units > BigInt(0)) {
      await tx.productStock.upsert({
        where: { productId_warehouseId: { productId: d.productId, warehouseId: d.warehouseId } },
        create: { productId: d.productId, warehouseId: d.warehouseId, quantity: qty },
        update: { quantity: { increment: qty } },
      });
    } else {
      const r = await tx.productStock.updateMany({
        where: { productId: d.productId, warehouseId: d.warehouseId, quantity: { gte: qty } },
        data: { quantity: { decrement: qty } },
      });
      if (r.count !== 1) {
        const s = await tx.productStock.findUnique({ where: { productId_warehouseId: { productId: d.productId, warehouseId: d.warehouseId } }, select: { quantity: true } });
        throw new StockError(d.productId, labels.get(d.productId) ?? aProduct, s ? s.quantity.toFixed(3) : "0.000", qty);
      }
    }
  }
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt < 4 && isKnown(e, "P2002", "P2034")) continue; // new stock row race / deadlock
      throw e;
    }
  }
}

/** Lock the adjustment row, then read its original warehouse + items (current, committed data). */
async function lockOriginal(tx: Tx, id: string) {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM stock_adjustments WHERE id = ${id} FOR UPDATE`;
  if (!locked.length) throw new GoneError();
  const a = await tx.stockAdjustment.findUniqueOrThrow({
    where: { id },
    select: { id: true, reference: true, warehouseId: true, adjustmentDate: true, createdAt: true, items: { select: { productId: true, baseQuantity: true, type: true, product: { select: { code: true, name: true } } } } },
  });
  const lines: Line[] = a.items.map((i) => ({ productId: i.productId, quantity: i.baseQuantity.toFixed(3), type: i.type }));
  const labels = new Map(a.items.map((i) => [i.productId, `${i.product.code} ${i.product.name}`]));
  return { ...a, lines, labels };
}

function historyFailure(e: StockHistoryError, t: Dictionary): AdjustmentResult {
  const message = errorMessage(t, e);
  return { ok: false, message, fieldErrors: { items: message }, itemErrors: e.itemId ? { [e.itemId]: message } : undefined };
}

function stockFailure(e: StockError, action: "save" | "edit" | "delete", t: Dictionary): AdjustmentResult {
  const have = formatQuantity(e.available);
  const E = t.adjustments.err;
  const message = fmt(action === "delete" ? E.stockDelete : action === "edit" ? E.stockEdit : E.stockSave, { label: e.label, have });
  return { ok: false, message, fieldErrors: { items: message }, itemErrors: { [e.productId]: message } };
}

function revalidate() {
  revalidatePath("/adjustments");
  revalidatePath("/products"); // "In Stock" totals
}

const dateOf = (v: string) => new Date(`${v}T00:00:00.000Z`);

export async function createAdjustment(input: unknown): Promise<AdjustmentResult> {
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
        const t0 = await tx.stockAdjustment.create({
          data: {
            reference: `TMP_${randomBytes(8).toString("hex")}`, // replaced below, inside this transaction
            warehouseId: d.warehouseId,
            adjustmentDate: dateOf(d.adjustmentDate),
            createdById: a.userId,
            items: { create: d.items.map((i) => itemData(i, r.units)) },
          },
          select: { id: true, number: true, createdAt: true },
        });
        const ad = await tx.stockAdjustment.update({ where: { id: t0.id }, data: { reference: formatAdjustmentReference(t0.number) }, select: { id: true, reference: true } });
        const deltas: Deltas = new Map();
        addEffect(deltas, d.warehouseId, baseLines(d.items, r.units), 1);
        await applyDeltas(tx, deltas, r.labels, t.adjustments.err.aProduct);
        // A back-dated SUBTRACTION must keep every later balance >= 0 (additions can only raise balances).
        await assertNonNegativeHistory(tx, d.items.filter((i) => i.type === "SUBTRACTION").map((i) => ({ productId: i.productId, warehouseId: d.warehouseId, day: d.adjustmentDate, at: t0.createdAt.getTime() })));
        return ad;
      }),
    );
    revalidate();
    return { ok: true, message: fmt(t.adjustments.ok.created, { ref: created.reference }), id: created.id };
  } catch (e) {
    if (e instanceof StockHistoryError) return historyFailure(e, t);
    if (e instanceof StockError) return stockFailure(e, "save", t);
    if (isKnown(e, "P2003")) return { ok: false, message: t.adjustments.err.refsGone };
    throw e;
  }
}

/** Edit: reverse the original effect and apply the new one atomically (net change per product). */
export async function updateAdjustment(id: unknown, input: unknown): Promise<AdjustmentResult> {
  const t = await getDict();
  const a = await authorize(t);
  if ("error" in a) return a.error;
  const aid = idSchema.safeParse(id);
  if (!aid.success) return { ok: false, message: t.adjustments.err.notFound };
  if (!(await db.stockAdjustment.findUnique({ where: { id: aid.data }, select: { id: true } }))) return { ok: false, message: t.adjustments.err.notFound };
  const v = parse(input, t);
  if (!v.ok) return v.error;
  const r = await resolve(v.data, t);
  if (!r.ok) return r.error;
  const d = v.data;

  try {
    const ref = await withRetry(() =>
      stockTx(async (tx) => {
        const orig = await lockOriginal(tx, aid.data);
        const deltas: Deltas = new Map();
        addEffect(deltas, orig.warehouseId, orig.lines, -1); // reverse the original effect
        addEffect(deltas, d.warehouseId, baseLines(d.items, r.units), 1); // apply the new one
        await tx.stockAdjustment.update({ where: { id: orig.id }, data: { warehouseId: d.warehouseId, adjustmentDate: dateOf(d.adjustmentDate) } });
        await tx.stockAdjustmentItem.deleteMany({ where: { adjustmentId: orig.id } });
        await tx.stockAdjustmentItem.createMany({ data: d.items.map((i) => ({ adjustmentId: orig.id, ...itemData(i, r.units) })) });
        await applyDeltas(tx, deltas, new Map([...orig.labels, ...r.labels]), t.adjustments.err.aProduct);
        // Editing removes the old movements and adds the new ones: re-check every touched product + warehouse from the earliest of the old and new positions.
        const at = orig.createdAt.getTime();
        await assertNonNegativeHistory(tx, [
          ...orig.lines.map((l) => ({ productId: l.productId, warehouseId: orig.warehouseId, day: dayOfDateOnly(orig.adjustmentDate), at })),
          ...d.items.map((i) => ({ productId: i.productId, warehouseId: d.warehouseId, day: d.adjustmentDate, at })),
        ]);
        return orig.reference;
      }),
    );
    revalidate();
    return { ok: true, message: fmt(t.adjustments.ok.updated, { ref }), id: aid.data };
  } catch (e) {
    if (e instanceof StockHistoryError) return historyFailure(e, t);
    if (e instanceof StockError) return stockFailure(e, "edit", t);
    if (e instanceof GoneError) return { ok: false, message: t.adjustments.err.notFound };
    if (isKnown(e, "P2003")) return { ok: false, message: t.adjustments.err.refsGone };
    throw e;
  }
}

/** Delete: reverse the original effect atomically; refused if that would make stock negative. */
export async function deleteAdjustment(id: unknown): Promise<AdjustmentResult> {
  const t = await getDict();
  const a = await authorize(t);
  if ("error" in a) return a.error;
  const aid = idSchema.safeParse(id);
  if (!aid.success) return { ok: false, message: t.adjustments.err.notFound };

  try {
    const ref = await withRetry(() =>
      stockTx(async (tx) => {
        const orig = await lockOriginal(tx, aid.data);
        const deltas: Deltas = new Map();
        addEffect(deltas, orig.warehouseId, orig.lines, -1);
        await applyDeltas(tx, deltas, orig.labels, t.adjustments.err.aProduct);
        await tx.stockAdjustment.delete({ where: { id: orig.id } }); // items cascade
        // The reversal removes the original movements: later balances must still be >= 0.
        await assertNonNegativeHistory(tx, orig.lines.map((l) => ({ productId: l.productId, warehouseId: orig.warehouseId, day: dayOfDateOnly(orig.adjustmentDate), at: orig.createdAt.getTime() })));
        return orig.reference;
      }),
    );
    revalidate();
    return { ok: true, message: fmt(t.adjustments.ok.deleted, { ref }) };
  } catch (e) {
    if (e instanceof StockHistoryError) return historyFailure(e, t);
    if (e instanceof StockError) return stockFailure(e, "delete", t);
    if (e instanceof GoneError) return { ok: false, message: t.adjustments.err.notFound };
    throw e;
  }
}
