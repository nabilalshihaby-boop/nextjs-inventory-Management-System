"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { formatMoney, formatQuantity } from "@/lib/money";
import { getSystemSettings } from "@/lib/settings";
import { canManagePurchaseReturns } from "@/lib/roles";
import { calcReturn } from "@/lib/purchase-return-calc";
import { formatPurchaseReturnReference, makePurchaseReturnSchema, type PurchaseReturnField } from "@/lib/purchase-returns";
import { getDict } from "@/lib/i18n/server";
import { toBaseQuantity } from "@/lib/unit-math";
import { LocalizedError, errorMessage, tr, type Vars } from "@/lib/i18n/messages";
import type { Dictionary } from "@/lib/i18n";
import { StockHistoryError, assertNonNegativeHistory } from "@/lib/stock-history-guard";

// Purchase Returns. Integrity rules (server-side, all inside ONE transaction):
// - OWNER/ADMIN only; auth() is re-read and the role never comes from the client.
// - The browser sends only: purchase id, purchase-line ids + quantities, date, notes. The purchase
//   row is locked (SELECT … FOR UPDATE) first, then the purchase, its lines, products and every
//   earlier return are re-read, so concurrent returns of the same purchase are serialized and can
//   never exceed the received quantity.
// - Only RECEIVED purchases can be returned; the return date can't be before the purchase date or
//   in the future. Per line: quantity ≤ purchased − already returned.
// - Stock is deducted with a conditional UPDATE … WHERE quantity >= n per product in the
//   purchase's warehouse — never below zero, even if the stock was later sold/transferred/adjusted.
//   The return lines are the stock movement record (like transfers and adjustments).
// - Amounts are prorated, exactly and cumulatively, from the original purchase's stored snapshot
//   (lib/purchase-return-calc.ts); client totals are never used. Original purchase lines, totals and
//   product costs are not modified. The purchase's Due = Grand Total − Paid − completed returns.
// - No Cash/Bank ledger rows are written. A return can't exceed the purchase's current Due
//   (Grand Total − Paid − earlier returns): refunds / supplier credit for paid amounts are deferred.
// - Returns are immutable: there are no edit/delete actions.

export type PurchaseReturnResult =
  | { ok: true; message: string; id?: string }
  | { ok: false; message: string; fieldErrors?: Partial<Record<PurchaseReturnField, string>>; itemErrors?: Record<string, string> };

class ReturnError extends LocalizedError {
  constructor(key: string, vars: Vars, readonly field?: PurchaseReturnField, itemId?: string) {
    super(key, vars, itemId);
  }
}
const fail = (key: string, vars: Vars = {}, field?: PurchaseReturnField, itemId?: string): never => {
  throw new ReturnError(key, vars, field, itemId);
};
const isKnown = (e: unknown, ...codes: string[]) => e instanceof Prisma.PrismaClientKnownRequestError && codes.includes(e.code);
const dateOnly = (v: string) => new Date(`${v}T00:00:00.000Z`);

async function authorize(): Promise<{ userId: string; t: Dictionary } | { error: PurchaseReturnResult }> {
  const s = await auth();
  const t = await getDict();
  if (!s?.user?.id) return { error: { ok: false, message: t.common.sessionExpired } };
  if (!canManagePurchaseReturns(s.user.role)) return { error: { ok: false, message: t.purchaseReturns.err.noPermission } };
  return { userId: s.user.id, t };
}

export async function createPurchaseReturn(input: unknown): Promise<PurchaseReturnResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const t = a.t;
  const v = makePurchaseReturnSchema(t.purchaseReturns.val, t.purchases.val).safeParse(input);
  if (!v.success) {
    const fieldErrors: Partial<Record<PurchaseReturnField, string>> = {};
    for (const i of v.error.issues) fieldErrors[(i.path[0] as PurchaseReturnField) ?? "items"] ??= i.message;
    return { ok: false, message: Object.values(fieldErrors)[0] ?? t.common.checkForm, fieldErrors };
  }
  const d = v.data;
  const settings = await getSystemSettings();

  for (let attempt = 1; ; attempt++) {
    try {
      const created = await db.$transaction(
        async (tx) => {
          // 1. Lock the purchase, then re-read it (current committed data only).
          const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM purchases WHERE id = ${d.purchaseId} FOR UPDATE`;
          if (!locked.length) fail("purchaseReturns.val.choosePurchase", {}, "purchaseId");
          const p = await tx.purchase.findUniqueOrThrow({
            where: { id: d.purchaseId },
            select: {
              id: true, reference: true, status: true, purchaseDate: true, supplierId: true, warehouseId: true, currencyId: true,
              subtotal: true, orderTaxAmount: true, discount: true, grandTotal: true, paidAmount: true,
              currency: { select: { symbol: true } },
              warehouse: { select: { name: true } },
              items: { select: { id: true, productId: true, quantity: true, baseQuantity: true, unitId: true, unitName: true, unitFactor: true, unitCost: true, netUnitCost: true, taxType: true, taxRate: true, discountType: true, discountValue: true, discountAmount: true, taxAmount: true, subtotal: true, product: { select: { code: true, name: true } } } },
            },
          });
          if (p.status !== "RECEIVED") fail("purchaseReturns.err.notReceived", { ref: p.reference }, "purchaseId");
          if (dateOnly(d.returnDate) < p.purchaseDate) fail("purchaseReturns.err.beforePurchase", { ref: p.reference }, "returnDate");

          // 2. Everything already returned from this purchase.
          const [priorByLine, priorSub] = await Promise.all([
            tx.purchaseReturnItem.groupBy({ by: ["purchaseItemId"], where: { purchaseReturn: { purchaseId: p.id } }, _sum: { quantity: true, baseQuantity: true } }),
            tx.purchaseReturn.aggregate({ where: { purchaseId: p.id }, _sum: { subtotal: true, grandTotal: true } }),
          ]);
          const returnedOf = new Map(priorByLine.map((r) => [r.purchaseItemId, r._sum.quantity ?? new Prisma.Decimal(0)]));
          const returnedBaseOf = new Map(priorByLine.map((r) => [r.purchaseItemId, r._sum.baseQuantity ?? new Prisma.Decimal(0)]));
          const byId = new Map(p.items.map((i) => [i.id, i]));

          // 3. Lines: must belong to this purchase and stay within the returnable quantity.
          const lines = d.items.map((it) => {
            const pi = byId.get(it.purchaseItemId) ?? fail("purchaseReturns.err.wrongPurchase", {}, "items", it.purchaseItemId);
            const returned = returnedOf.get(pi.id) ?? new Prisma.Decimal(0);
            const returnable = new Prisma.Decimal(pi.quantity).minus(returned);
            if (new Prisma.Decimal(it.quantity).gt(returnable)) {
              fail("purchaseReturns.err.exceeds", { returnable: formatQuantity(returnable.toFixed(3)), code: pi.product.code, name: pi.product.name, bought: formatQuantity(pi.quantity.toFixed(3)), returned: formatQuantity(returned.toFixed(3)) }, "items", pi.id);
            }
            // A return uses the ORIGINAL line's unit and factor; the base quantity is converted exactly and may never exceed
            // what is still returnable measured in BASE units either.
            const b = toBaseQuantity(it.quantity, pi.unitFactor.toFixed(6));
            const baseQty = b.ok ? b.value : fail("units.err.baseDecimals", { product: `${pi.product.code} ${pi.product.name}`, unit: pi.unitName ?? "", qty: it.quantity, factor: pi.unitFactor.toFixed(6) }, "items", pi.id);
            const returnableBase = new Prisma.Decimal(pi.baseQuantity).minus(returnedBaseOf.get(pi.id) ?? new Prisma.Decimal(0));
            if (new Prisma.Decimal(baseQty).gt(returnableBase)) {
              fail("purchaseReturns.err.exceeds", { returnable: formatQuantity(returnable.toFixed(3)), code: pi.product.code, name: pi.product.name, bought: formatQuantity(pi.quantity.toFixed(3)), returned: formatQuantity(returned.toFixed(3)) }, "items", pi.id);
            }
            return { pi, quantity: it.quantity, base: baseQty, returned: returned.toFixed(3) };
          });

          // 4. Server-side amounts from the original snapshot.
          const calc = calcReturn(
            { subtotal: p.subtotal.toFixed(2), orderTaxAmount: p.orderTaxAmount.toFixed(2), discount: p.discount.toFixed(2), returnedSubtotal: (priorSub._sum.subtotal ?? new Prisma.Decimal(0)).toFixed(2) },
            lines.map((l) => ({ original: { quantity: l.pi.quantity.toFixed(3), subtotal: l.pi.subtotal.toFixed(2), taxAmount: l.pi.taxAmount.toFixed(2), discountAmount: l.pi.discountAmount.toFixed(2), returned: l.returned }, quantity: l.quantity })),
          );

          // 4b. Refund / supplier-credit is NOT built: a return may only reduce what is still owed.
          //     (Payments lock this same purchase row, so Paid can't change concurrently.)
          const due = new Prisma.Decimal(p.grandTotal).minus(p.paidAmount).minus(priorSub._sum.grandTotal ?? 0);
          if (new Prisma.Decimal(calc.grandTotal).gt(due)) {
            const m = (x: Prisma.Decimal) => formatMoney(x.toFixed(2), { code: "", symbol: p.currency.symbol, right: !!settings?.currencyIconRight });
            if (due.gt(0)) fail("purchaseReturns.err.dueExceeded", { worth: m(new Prisma.Decimal(calc.grandTotal)), due: m(due), ref: p.reference }, "items");
            fail("purchaseReturns.err.fullyPaid", { ref: p.reference }, "items");
          }

          // 5. Deduct stock — conditional, never below zero (stable lock order by product).
          for (const l of [...lines].sort((x, y) => x.pi.productId.localeCompare(y.pi.productId))) {
            const r = await tx.productStock.updateMany({ where: { productId: l.pi.productId, warehouseId: p.warehouseId, quantity: { gte: l.base } }, data: { quantity: { decrement: l.base } } });
            if (r.count !== 1) {
              const s = await tx.productStock.findUnique({ where: { productId_warehouseId: { productId: l.pi.productId, warehouseId: p.warehouseId } }, select: { quantity: true } });
              fail("purchaseReturns.err.noStock", { code: l.pi.product.code, name: l.pi.product.name, warehouse: p.warehouse.name, qty: formatQuantity(new Prisma.Decimal(l.base).toFixed(3)), available: formatQuantity((s?.quantity ?? new Prisma.Decimal(0)).toFixed(3)) }, "items", l.pi.id);
            }
          }

          // 6. The immutable return record (+ snapshot lines) with a never-reused reference.
          const r0 = await tx.purchaseReturn.create({
            data: {
              reference: `TMP_${randomBytes(8).toString("hex")}`, // replaced below, inside this transaction
              returnDate: dateOnly(d.returnDate),
              purchaseId: p.id,
              supplierId: p.supplierId,
              warehouseId: p.warehouseId,
              currencyId: p.currencyId,
              subtotal: calc.subtotal,
              orderTaxAmount: calc.orderTaxAmount,
              discount: calc.discount,
              shipping: calc.shipping,
              grandTotal: calc.grandTotal,
              notes: d.notes || null,
              createdById: a.userId,
              items: {
                create: lines.map((l, n) => ({
                  purchaseItemId: l.pi.id,
                  productId: l.pi.productId,
                  quantity: l.quantity,
                  unitId: l.pi.unitId,
                  unitName: l.pi.unitName,
                  unitFactor: l.pi.unitFactor,
                  baseQuantity: l.base,
                  unitCost: l.pi.unitCost,
                  netUnitCost: l.pi.netUnitCost,
                  taxType: l.pi.taxType,
                  taxRate: l.pi.taxRate,
                  discountType: l.pi.discountType,
                  discountValue: l.pi.discountValue,
                  discountAmount: calc.lines[n].discountAmount,
                  taxAmount: calc.lines[n].taxAmount,
                  subtotal: calc.lines[n].subtotal,
                })),
              },
            },
            select: { id: true, number: true, createdAt: true },
          });
          const reference = formatPurchaseReturnReference(r0.number);
          await tx.purchaseReturn.update({ where: { id: r0.id }, data: { reference } });
          // Chronological guard: the return is dated d.returnDate (possibly in the past) and takes stock out, so every
          // later balance of these products in this warehouse must still be >= 0.
          await assertNonNegativeHistory(tx, lines.map((l) => ({ productId: l.pi.productId, warehouseId: p.warehouseId, day: d.returnDate, at: r0.createdAt.getTime() })));
          return { id: r0.id, reference, purchaseId: p.id, purchaseRef: p.reference };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 },
      );
      revalidatePath("/purchases/returns");
      revalidatePath("/purchases");
      revalidatePath(`/purchases/${created.purchaseId}`);
      revalidatePath("/products");
      return { ok: true, message: tr(t, "purchaseReturns.ok.created", { ref: created.reference, purchase: created.purchaseRef }), id: created.id };
    } catch (e) {
      if (e instanceof ReturnError) {
        const message = errorMessage(t, e);
        return { ok: false, message, fieldErrors: e.field ? { [e.field]: message } : undefined, itemErrors: e.itemId ? { [e.itemId]: message } : undefined };
      }
      if (e instanceof StockHistoryError) {
        const message = errorMessage(t, e);
        return { ok: false, message, fieldErrors: { items: message } };
      }
      if (attempt < 4 && isKnown(e, "P2034")) continue; // deadlock / write conflict → retry
      if (isKnown(e, "P2003")) return { ok: false, message: t.purchaseReturns.err.refsGone };
      throw e;
    }
  }
}
