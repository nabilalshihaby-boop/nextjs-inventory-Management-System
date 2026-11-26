"use server";

import { InactiveProductError, assertProductsActive, inactiveProductRefusal } from "@/lib/product-status";
import { recordScopeError, scopeError } from "@/lib/access-scope";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { canManagePurchases } from "@/lib/roles";
import { getDefaultCurrency } from "@/lib/settings";
import { toUnits } from "@/lib/transfers";
import { calcOrder } from "@/lib/purchase-calc";
import { formatPurchaseReference, makePurchaseSchema, type PurchaseField, type PurchaseInput } from "@/lib/purchases";
import { getDict } from "@/lib/i18n/server";
import { lineSnapshot, loadUnitSets, resolveLine, type ResolvedUnit } from "@/lib/product-units";
import { errorMessage, tr } from "@/lib/i18n/messages";
import type { Dictionary } from "@/lib/i18n";

// Purchases. Integrity rules (server-side):
// - OWNER/ADMIN only; auth() is re-read in every action and the role never comes from the client.
// - Supplier, warehouse and products are looked up in MySQL. All money (line discounts, taxes,
//   subtotals, order tax, grand total) is recomputed here with lib/purchase-calc.ts — client
//   totals are never trusted. The currency is the System Settings default currency.
// - RECEIVED adds each line's quantity to ProductStock(product, warehouse) in the SAME transaction
//   that creates the purchase. PENDING/ORDERED change no stock; "Mark as Received" moves them to
//   RECEIVED with a conditional update (only from PENDING/ORDERED), so stock is added exactly once.
// - No payments yet: paidAmount stays 0 (Unpaid). No cash/bank ledger rows are written.
// - Purchases are immutable in this step (no edit/delete actions).

export type PurchaseResult =
  | { ok: true; message: string; id?: string }
  | { ok: false; message: string; fieldErrors?: Partial<Record<PurchaseField, string>>; itemErrors?: Record<string, string> };

const idSchema = z.string().trim().min(1).max(64);
const MAX_TOTAL = toUnits("999999999999.99", 2);

async function authorize(): Promise<{ userId: string; t: Dictionary } | { error: PurchaseResult }> {
  const s = await auth();
  const t = await getDict();
  if (!s?.user?.id) return { error: { ok: false, message: t.common.sessionExpired } };
  if (!canManagePurchases(s.user)) return { error: { ok: false, message: t.purchases.err.noPermission } };
  return { userId: s.user.id, t };
}

function parse(input: unknown, t: Dictionary): { ok: true; data: PurchaseInput } | { ok: false; error: PurchaseResult } {
  const v = makePurchaseSchema(t.purchases.val).safeParse(input);
  if (v.success) return { ok: true, data: v.data };
  const fieldErrors: Partial<Record<PurchaseField, string>> = {};
  const itemErrors: Record<string, string> = {};
  const raw = (input && typeof input === "object" ? (input as { items?: unknown }).items : undefined) as { productId?: unknown }[] | undefined;
  for (const i of v.error.issues) {
    const [k, index] = i.path;
    if (k === "items" && typeof index === "number" && Array.isArray(raw) && typeof raw[index]?.productId === "string") itemErrors[raw[index].productId as string] ??= i.message;
    fieldErrors[(k as PurchaseField) ?? "items"] ??= i.message;
  }
  return { ok: false, error: { ok: false, message: Object.values(fieldErrors)[0] ?? t.common.checkForm, fieldErrors, itemErrors } };
}

const isKnown = (e: unknown, ...codes: string[]) => e instanceof Prisma.PrismaClientKnownRequestError && codes.includes(e.code);
const dateOnly = (v: string) => new Date(`${v}T00:00:00.000Z`);

/** Add each line's quantity to ProductStock(product, warehouse) — stable lock order (product id). */
async function addStock(tx: Prisma.TransactionClient, warehouseId: string, lines: { productId: string; quantity: Prisma.Decimal | string }[]) {
  for (const l of [...lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
    await tx.productStock.upsert({
      where: { productId_warehouseId: { productId: l.productId, warehouseId } },
      create: { productId: l.productId, warehouseId, quantity: l.quantity },
      update: { quantity: { increment: l.quantity } },
    });
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

function revalidate(id?: string) {
  revalidatePath("/purchases");
  if (id) revalidatePath(`/purchases/${id}`);
  revalidatePath("/products"); // In Stock
}

export async function createPurchase(input: unknown): Promise<PurchaseResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const t = a.t;
  const v = parse(input, t);
  if (!v.ok) return v.error;
  const d = v.data;
  const scopeMsg = await scopeError([d.warehouseId]);
  if (scopeMsg) return { ok: false, message: scopeMsg };
  const currency = await getDefaultCurrency();
  if (!currency) return { ok: false, message: t.purchases.err.noCurrency };

  const [supplier, warehouse, products] = await Promise.all([
    db.supplier.findUnique({ where: { id: d.supplierId }, select: { id: true } }),
    db.warehouse.findUnique({ where: { id: d.warehouseId }, select: { id: true } }),
    db.product.findMany({ where: { id: { in: d.items.map((i) => i.productId) } }, select: { id: true, code: true, name: true } }),
  ]);
  if (!supplier) return { ok: false, message: t.purchases.err.invalidSupplier, fieldErrors: { supplierId: t.purchases.err.invalidSupplier } };
  if (!warehouse) return { ok: false, message: t.purchases.err.invalidWarehouse, fieldErrors: { warehouseId: t.purchases.err.invalidWarehouse } };
  const known = new Set(products.map((p) => p.id));
  const missing = d.items.find((i) => !known.has(i.productId));
  if (missing) return { ok: false, message: t.purchases.err.productGone, fieldErrors: { items: t.purchases.err.productGone }, itemErrors: { [missing.productId]: t.purchases.err.itemGone } };
  // An inactive product can't be bought in a NEW purchase (its past purchases and returns are unaffected).
  const refused = await inactiveProductRefusal(db, d.items.map((i) => i.productId), t);
  if (refused) return { ok: false, message: refused.message, fieldErrors: { items: refused.message }, itemErrors: { [refused.productId]: refused.message } };

  // Units: every line's unit must be an active PURCHASE conversion of THIS product; the factor and the base quantity
  // come from MySQL, never from the browser. Stock is added in base units.
  const sets = await loadUnitSets(db, d.items.map((i) => i.productId));
  const lineUnit = new Map<string, ResolvedUnit>();
  const unitErrors: Record<string, string> = {};
  for (const i of d.items) {
    const pr = products.find((x) => x.id === i.productId)!;
    const r = resolveLine(sets.get(i.productId), i.unitId, "PURCHASE", i.quantity, `${pr.code} ${pr.name}`);
    if (r.ok) lineUnit.set(i.productId, r.r);
    else unitErrors[i.productId] = tr(t, r.f.key, r.f.vars);
  }
  if (Object.keys(unitErrors).length) {
    const m = Object.values(unitErrors)[0];
    return { ok: false, message: m, fieldErrors: { items: m }, itemErrors: unitErrors };
  }

  // Authoritative totals (server-side).
  const calc = calcOrder(d.items, { orderTaxRate: d.orderTaxRate, discount: d.discount, shipping: d.shipping });
  const badLine = calc.lines.findIndex((l) => l.error);
  if (badLine >= 0) {
    const pid = d.items[badLine].productId;
    const lm = calc.lines[badLine].errorKey ? tr(t, calc.lines[badLine].errorKey!) : calc.lines[badLine].error!;
    return { ok: false, message: lm, fieldErrors: { items: lm }, itemErrors: { [pid]: lm } };
  }
  if (calc.error) {
    const om = calc.errorKey ? tr(t, calc.errorKey) : calc.error;
    return { ok: false, message: om, fieldErrors: { discount: om } };
  }
  if (toUnits(calc.grandTotal, 2) > MAX_TOTAL || toUnits(calc.subtotal, 2) > MAX_TOTAL) return { ok: false, message: t.purchases.err.totalTooLarge, fieldErrors: { items: t.purchases.err.totalTooLarge } };

  try {
    const created = await withRetry(() =>
      db.$transaction(async (tx) => {
        await assertProductsActive(tx, d.items.map((i) => i.productId));
        const p0 = await tx.purchase.create({
          data: {
            reference: `TMP_${randomBytes(8).toString("hex")}`, // replaced below, inside this transaction
            purchaseDate: dateOnly(d.purchaseDate),
            supplierId: d.supplierId,
            warehouseId: d.warehouseId,
            status: d.status,
            currencyId: currency.id,
            subtotal: calc.subtotal,
            orderTaxRate: d.orderTaxRate,
            orderTaxAmount: calc.orderTaxAmount,
            discount: d.discount,
            shipping: d.shipping,
            grandTotal: calc.grandTotal,
            paidAmount: "0",
            notes: d.notes || null,
            createdById: a.userId,
            ...(d.status === "RECEIVED" ? { receivedAt: new Date(), receivedById: a.userId } : {}),
            items: {
              create: d.items.map((i, n) => ({
                productId: i.productId,
                quantity: i.quantity,
                ...lineSnapshot(lineUnit.get(i.productId)!),
                unitCost: i.unitCost,
                taxType: i.taxType,
                taxRate: i.taxRate,
                discountType: i.discountType,
                discountValue: i.discountValue,
                discountAmount: calc.lines[n].discountAmount,
                taxAmount: calc.lines[n].taxAmount,
                netUnitCost: calc.lines[n].netUnitCost,
                subtotal: calc.lines[n].subtotal,
              })),
            },
          },
          select: { id: true, number: true },
        });
        const reference = formatPurchaseReference(p0.number);
        await tx.purchase.update({ where: { id: p0.id }, data: { reference } });
        if (d.status === "RECEIVED") await addStock(tx, d.warehouseId, d.items.map((i) => ({ productId: i.productId, quantity: lineUnit.get(i.productId)!.baseQuantity })));
        return { id: p0.id, reference };
      }),
    );
    revalidate(created.id);
    return { ok: true, message: tr(t, d.status === "RECEIVED" ? "purchases.ok.createdReceived" : "purchases.ok.createdPending", { ref: created.reference }), id: created.id };
  } catch (e) {
    if (e instanceof InactiveProductError) return { ok: false, message: errorMessage(t, e), fieldErrors: { items: errorMessage(t, e) } };
    if (isKnown(e, "P2003")) return { ok: false, message: t.purchases.err.refsGone };
    throw e;
  }
}

/** PENDING/ORDERED → RECEIVED: adds the stock exactly once (conditional on the current status). */
export async function markPurchaseReceived(id: unknown): Promise<PurchaseResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const t = a.t;
  const pid = idSchema.safeParse(id);
  if (!pid.success) return { ok: false, message: t.purchases.err.notFound };
  const scopeRec = await recordScopeError("purchase", pid.data);
  if (scopeRec) return { ok: false, message: scopeRec };
  const p = await db.purchase.findUnique({ where: { id: pid.data }, select: { id: true, reference: true, status: true } });
  if (!p) return { ok: false, message: t.purchases.err.notFound };
  if (p.status === "RECEIVED") return { ok: false, message: tr(t, "purchases.err.alreadyReceived", { ref: p.reference }) };

  const done = await withRetry(() =>
    db.$transaction(async (tx) => {
      const u = await tx.purchase.updateMany({ where: { id: p.id, status: { in: ["PENDING", "ORDERED"] } }, data: { status: "RECEIVED", receivedAt: new Date(), receivedById: a.userId } });
      if (u.count !== 1) return false; // someone else received it first — no stock added twice
      const row = await tx.purchase.findUniqueOrThrow({ where: { id: p.id }, select: { warehouseId: true, items: { select: { productId: true, baseQuantity: true } } } });
      await addStock(tx, row.warehouseId, row.items.map((i) => ({ productId: i.productId, quantity: i.baseQuantity })));
      return true;
    }),
  );
  if (!done) return { ok: false, message: tr(t, "purchases.err.alreadyReceived", { ref: p.reference }) };
  revalidate(p.id);
  return { ok: true, message: tr(t, "purchases.ok.received", { ref: p.reference }) };
}
