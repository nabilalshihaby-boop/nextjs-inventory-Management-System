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
import { adjustmentInputSchema, formatAdjustmentReference, signedUnits, type AdjustmentField, type AdjustmentInput, type AdjustmentTypeValue } from "@/lib/adjustments";

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
const NOT_FOUND = "Adjustment not found";

class StockError extends Error {
  constructor(readonly productId: string, readonly label: string, readonly available: string, readonly needed: string) {
    super("insufficient stock");
  }
}
class GoneError extends Error {}

async function authorize(): Promise<{ userId: string } | { error: AdjustmentResult }> {
  const session = await auth();
  if (!session?.user?.id) return { error: { ok: false, message: "Your session has expired. Please sign in again." } };
  if (!canManageAdjustments(session.user.role)) return { error: { ok: false, message: "You don't have permission to change adjustments." } };
  return { userId: session.user.id };
}

const isKnown = (e: unknown, ...codes: string[]) => e instanceof Prisma.PrismaClientKnownRequestError && codes.includes(e.code);

function parse(input: unknown): { ok: true; data: AdjustmentInput } | { ok: false; error: AdjustmentResult } {
  const parsed = adjustmentInputSchema.safeParse(input);
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
  return { ok: false, error: { ok: false, message: Object.values(fieldErrors)[0] ?? "Please check the form", fieldErrors, itemErrors } };
}

/** Warehouse and every product must exist in MySQL. Returns product labels for messages. */
async function resolve(d: AdjustmentInput): Promise<{ ok: true; labels: Map<string, string> } | { ok: false; error: AdjustmentResult }> {
  const [warehouse, products] = await Promise.all([
    db.warehouse.findUnique({ where: { id: d.warehouseId }, select: { id: true } }),
    db.product.findMany({ where: { id: { in: d.items.map((i) => i.productId) } }, select: { id: true, code: true, name: true } }),
  ]);
  const fieldErrors: Partial<Record<AdjustmentField, string>> = {};
  const itemErrors: Record<string, string> = {};
  if (!warehouse) fieldErrors.warehouseId = "Choose a valid warehouse";
  const labels = new Map(products.map((p) => [p.id, `${p.code} ${p.name}`]));
  for (const i of d.items) if (!labels.has(i.productId)) itemErrors[i.productId] = "This product no longer exists";
  if (Object.keys(itemErrors).length) fieldErrors.items ??= Object.values(itemErrors)[0];
  if (Object.keys(fieldErrors).length) return { ok: false, error: { ok: false, message: Object.values(fieldErrors)[0]!, fieldErrors, itemErrors } };
  return { ok: true, labels };
}

type Line = { productId: string; quantity: string; type: AdjustmentTypeValue };
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
async function applyDeltas(tx: Tx, deltas: Deltas, labels: Map<string, string>) {
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
        throw new StockError(d.productId, labels.get(d.productId) ?? "a product", s ? s.quantity.toFixed(3) : "0.000", qty);
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
    select: { id: true, reference: true, warehouseId: true, items: { select: { productId: true, quantity: true, type: true, product: { select: { code: true, name: true } } } } },
  });
  const lines: Line[] = a.items.map((i) => ({ productId: i.productId, quantity: i.quantity.toFixed(3), type: i.type }));
  const labels = new Map(a.items.map((i) => [i.productId, `${i.product.code} ${i.product.name}`]));
  return { ...a, lines, labels };
}

function stockFailure(e: StockError, action: "save" | "edit" | "delete"): AdjustmentResult {
  const have = formatQuantity(e.available);
  const message =
    action === "delete"
      ? `This adjustment can't be deleted: reversing it would make the stock of ${e.label} negative (only ${have} left).`
      : action === "edit"
        ? `Not enough stock of ${e.label}: this change would make its stock negative (only ${have} available).`
        : `Not enough stock of ${e.label} to subtract (only ${have} available).`;
  return { ok: false, message, fieldErrors: { items: message }, itemErrors: { [e.productId]: message } };
}

function revalidate() {
  revalidatePath("/adjustments");
  revalidatePath("/products"); // "In Stock" totals
}

const dateOf = (v: string) => new Date(`${v}T00:00:00.000Z`);

export async function createAdjustment(input: unknown): Promise<AdjustmentResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const v = parse(input);
  if (!v.ok) return v.error;
  const r = await resolve(v.data);
  if (!r.ok) return r.error;
  const d = v.data;

  try {
    const created = await withRetry(() =>
      db.$transaction(async (tx) => {
        const t0 = await tx.stockAdjustment.create({
          data: {
            reference: `TMP_${randomBytes(8).toString("hex")}`, // replaced below, inside this transaction
            warehouseId: d.warehouseId,
            adjustmentDate: dateOf(d.adjustmentDate),
            createdById: a.userId,
            items: { create: d.items.map((i) => ({ productId: i.productId, quantity: i.quantity, type: i.type })) },
          },
          select: { id: true, number: true },
        });
        const t = await tx.stockAdjustment.update({ where: { id: t0.id }, data: { reference: formatAdjustmentReference(t0.number) }, select: { id: true, reference: true } });
        const deltas: Deltas = new Map();
        addEffect(deltas, d.warehouseId, d.items, 1);
        await applyDeltas(tx, deltas, r.labels);
        return t;
      }),
    );
    revalidate();
    return { ok: true, message: `Adjustment ${created.reference} created`, id: created.id };
  } catch (e) {
    if (e instanceof StockError) return stockFailure(e, "save");
    if (isKnown(e, "P2003")) return { ok: false, message: "The warehouse or a product no longer exists. Refresh and try again." };
    throw e;
  }
}

/** Edit: reverse the original effect and apply the new one atomically (net change per product). */
export async function updateAdjustment(id: unknown, input: unknown): Promise<AdjustmentResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const aid = idSchema.safeParse(id);
  if (!aid.success) return { ok: false, message: NOT_FOUND };
  if (!(await db.stockAdjustment.findUnique({ where: { id: aid.data }, select: { id: true } }))) return { ok: false, message: NOT_FOUND };
  const v = parse(input);
  if (!v.ok) return v.error;
  const r = await resolve(v.data);
  if (!r.ok) return r.error;
  const d = v.data;

  try {
    const ref = await withRetry(() =>
      db.$transaction(async (tx) => {
        const orig = await lockOriginal(tx, aid.data);
        const deltas: Deltas = new Map();
        addEffect(deltas, orig.warehouseId, orig.lines, -1); // reverse the original effect
        addEffect(deltas, d.warehouseId, d.items, 1); // apply the new one
        await tx.stockAdjustment.update({ where: { id: orig.id }, data: { warehouseId: d.warehouseId, adjustmentDate: dateOf(d.adjustmentDate) } });
        await tx.stockAdjustmentItem.deleteMany({ where: { adjustmentId: orig.id } });
        await tx.stockAdjustmentItem.createMany({ data: d.items.map((i) => ({ adjustmentId: orig.id, productId: i.productId, quantity: i.quantity, type: i.type })) });
        await applyDeltas(tx, deltas, new Map([...orig.labels, ...r.labels]));
        return orig.reference;
      }),
    );
    revalidate();
    return { ok: true, message: `Adjustment ${ref} updated`, id: aid.data };
  } catch (e) {
    if (e instanceof StockError) return stockFailure(e, "edit");
    if (e instanceof GoneError) return { ok: false, message: NOT_FOUND };
    if (isKnown(e, "P2003")) return { ok: false, message: "The warehouse or a product no longer exists. Refresh and try again." };
    throw e;
  }
}

/** Delete: reverse the original effect atomically; refused if that would make stock negative. */
export async function deleteAdjustment(id: unknown): Promise<AdjustmentResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const aid = idSchema.safeParse(id);
  if (!aid.success) return { ok: false, message: NOT_FOUND };

  try {
    const ref = await withRetry(() =>
      db.$transaction(async (tx) => {
        const orig = await lockOriginal(tx, aid.data);
        const deltas: Deltas = new Map();
        addEffect(deltas, orig.warehouseId, orig.lines, -1);
        await applyDeltas(tx, deltas, orig.labels);
        await tx.stockAdjustment.delete({ where: { id: orig.id } }); // items cascade
        return orig.reference;
      }),
    );
    revalidate();
    return { ok: true, message: `Adjustment ${ref} deleted` };
  } catch (e) {
    if (e instanceof StockError) return stockFailure(e, "delete");
    if (e instanceof GoneError) return { ok: false, message: NOT_FOUND };
    throw e;
  }
}
