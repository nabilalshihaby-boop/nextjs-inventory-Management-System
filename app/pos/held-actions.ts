"use server";

import { randomBytes } from "node:crypto";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { holdOrderSchema, heldIdSchema, type HeldOrderSummary, type ResumedOrder } from "@/lib/pos-held";
import { getHeldOrders } from "@/lib/pos-held-data";
import { getDict } from "@/lib/i18n/server";
import { tr } from "@/lib/i18n/messages";
import type { Dictionary } from "@/lib/i18n";
import { canUsePos } from "@/lib/roles";
import { getDefaultCurrency } from "@/lib/settings";
import { fromUnits, toUnits } from "@/lib/transfers";

// Held POS orders. A held order is a DRAFT: these actions only touch pos_held_orders /
// pos_held_order_items — never sales, payments, ledger, stock, customers or products.
// - OWNER/ADMIN only; auth() is re-read in every action (the role and user id never come from the client).
// - Only the creator can list/resume/discard/update an order; any other id looks like "not found"
//   (nothing about other users' orders is revealed).
// - Hold is idempotent: holdKey is UNIQUE, so a double-click/retry returns the first order.
// - Duplicate product lines are merged (exact BigInt sums). Resume re-validates every reference but
//   reserves nothing; checkout (posCheckout) re-reads products and stock again, as always.

export type HoldResult = { ok: true; message: string; id: string; reference: string; orders: HeldOrderSummary[] } | { ok: false; message: string };
export type ResumeResult = { ok: true; order: ResumedOrder } | { ok: false; message: string };
export type DiscardResult = { ok: true; message: string; orders: HeldOrderSummary[] } | { ok: false; message: string };

const MAX_OPEN_HELD = 50;
const isKnown = (e: unknown, ...codes: string[]) => e instanceof Prisma.PrismaClientKnownRequestError && codes.includes(e.code);

async function authorize(): Promise<{ userId: string; t: Dictionary } | { error: { ok: false; message: string } }> {
  const s = await auth();
  const t = await getDict();
  if (!s?.user?.id) return { error: { ok: false, message: t.common.sessionExpired } };
  if (!canUsePos(s.user.role)) return { error: { ok: false, message: t.pos.noPermission } };
  return { userId: s.user.id, t };
}

export async function listHeldOrders(): Promise<{ ok: true; orders: HeldOrderSummary[] } | { ok: false; message: string }> {
  const a = await authorize();
  if ("error" in a) return a.error;
  return { ok: true, orders: await getHeldOrders(a.userId) };
}

export async function holdPosOrder(input: unknown): Promise<HoldResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const t = a.t;
  const v = holdOrderSchema.safeParse(input);
  if (!v.success) return { ok: false, message: v.error.issues[0]?.code === "unrecognized_keys" ? t.common.unexpectedFields : (v.error.issues[0]?.message.startsWith("posTx.") ? tr(t, v.error.issues[0].message) : (v.error.issues[0]?.message ?? t.common.checkForm)) };
  const d = v.data;

  // Merge duplicate lines safely (exact thousandths).
  const merged = new Map<string, bigint>();
  for (const i of d.items) merged.set(i.productId, (merged.get(i.productId) ?? BigInt(0)) + toUnits(i.quantity, 3));
  for (const q of merged.values()) if (q > toUnits("99999999999.999", 3)) return { ok: false, message: t.posTx.held.qtyLarge };

  const accountIds = [...new Set(d.tenders.map((t) => t.cashBankAccountId).filter(Boolean))];
  const [products, customer, warehouse, accountRows] = await Promise.all([
    db.product.findMany({ where: { id: { in: [...merged.keys()] } }, select: { id: true, code: true, name: true, price: true } }),
    d.customerId ? db.customer.findUnique({ where: { id: d.customerId }, select: { id: true } }) : Promise.resolve(true),
    d.warehouseId ? db.warehouse.findUnique({ where: { id: d.warehouseId }, select: { id: true } }) : Promise.resolve(true),
    accountIds.length ? db.cashBankAccount.findMany({ where: { id: { in: accountIds } }, select: { id: true } }) : Promise.resolve([]),
  ]);
  const byId = new Map(products.map((p) => [p.id, p]));
  if ([...merged.keys()].some((pid) => !byId.has(pid))) return { ok: false, message: t.posTx.held.productGone };
  if (!customer) return { ok: false, message: t.posTx.held.customerGone };
  if (!warehouse) return { ok: false, message: t.posTx.held.warehouseGone };
  if (accountRows.length !== accountIds.length) return { ok: false, message: t.posTx.held.accountGone };

  const itemRows = [...merged.entries()].map(([productId, q]) => {
    const p = byId.get(productId)!;
    return { productId, productCode: p.code, productName: p.name, quantity: fromUnits(q, 3), unitPrice: p.price };
  });
  const fields = { customerId: d.customerId || null, warehouseId: d.warehouseId || null, cashBankAccountId: null, paymentMethod: null, notes: d.notes || null };
  const tenderRows = d.tenders.map((t, position) => ({ position, paymentMethod: t.paymentMethod || null, cashBankAccountId: t.cashBankAccountId || null, amount: t.amount === "" ? null : t.amount }));

  try {
    const res = await db.$transaction(async (tx) => {
      if (d.heldOrderId) {
        // Updating the order this cart came from (no duplicate).
        await tx.$queryRaw`SELECT id FROM pos_held_orders WHERE id = ${d.heldOrderId} FOR UPDATE`;
        const cur = await tx.posHeldOrder.findFirst({ where: { id: d.heldOrderId, createdById: a.userId, status: "HELD" }, select: { id: true, reference: true } });
        if (!cur) return null;
        await tx.posHeldOrderItem.deleteMany({ where: { heldOrderId: cur.id } });
        await tx.posHeldOrderTender.deleteMany({ where: { heldOrderId: cur.id } });
        await tx.posHeldOrder.update({ where: { id: cur.id }, data: { ...fields, items: { create: itemRows }, tenders: { create: tenderRows } } });
        return { id: cur.id, reference: cur.reference, updated: true };
      }
      const open = await tx.posHeldOrder.count({ where: { createdById: a.userId, status: "HELD" } });
      if (open >= MAX_OPEN_HELD) throw new Error("LIMIT");
      const h0 = await tx.posHeldOrder.create({ data: { reference: `TMP_${randomBytes(8).toString("hex")}`, holdKey: d.holdKey, createdById: a.userId, ...fields, items: { create: itemRows }, tenders: { create: tenderRows } }, select: { id: true, number: true } });
      const reference = `HO_${String(h0.number).padStart(6, "0")}`;
      await tx.posHeldOrder.update({ where: { id: h0.id }, data: { reference } });
      return { id: h0.id, reference, updated: false };
    });
    if (!res) return { ok: false, message: t.posTx.held.notFound };
    return { ok: true, message: tr(t, res.updated ? "posTx.held.updated" : "posTx.held.held", { ref: res.reference }), id: res.id, reference: res.reference, orders: await getHeldOrders(a.userId) };
  } catch (e) {
    if (e instanceof Error && e.message === "LIMIT") return { ok: false, message: tr(t, "posTx.held.limit", { max: MAX_OPEN_HELD }) };
    if (isKnown(e, "P2002")) {
      // The same Hold action was already saved (double click / retry) → return that order.
      const ex = await db.posHeldOrder.findUnique({ where: { holdKey: d.holdKey }, select: { id: true, reference: true, createdById: true } });
      if (ex && ex.createdById === a.userId) return { ok: true, message: tr(t, "posTx.held.held", { ref: ex.reference }), id: ex.id, reference: ex.reference, orders: await getHeldOrders(a.userId) };
      return { ok: false, message: t.posTx.held.holdKey };
    }
    throw e;
  }
}

/** Load a held order for the cart, re-validating every reference. Writes nothing and reserves no stock. */
export async function resumeHeldOrder(id: unknown): Promise<ResumeResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const t = a.t;
  const NOT_FOUND = t.posTx.held.notFound;
  const D = t;
  const hid = heldIdSchema.safeParse(id);
  if (!hid.success) return { ok: false, message: NOT_FOUND };
  const o = await db.posHeldOrder.findFirst({ where: { id: hid.data, createdById: a.userId, status: "HELD" }, include: { items: { orderBy: { id: "asc" } }, tenders: { orderBy: { position: "asc" } } } });
  if (!o) return { ok: false, message: NOT_FOUND };

  // Saved tender rows; an order held BEFORE split payments has none and carries one legacy account/method: it resumes as ONE tender.
  const saved = o.tenders.length ? o.tenders.map((t) => ({ paymentMethod: t.paymentMethod ?? "", cashBankAccountId: t.cashBankAccountId ?? "", amount: t.amount ? t.amount.toFixed(2) : "" })) : o.cashBankAccountId || o.paymentMethod ? [{ paymentMethod: o.paymentMethod ?? "", cashBankAccountId: o.cashBankAccountId ?? "", amount: "" }] : [];
  const [customer, warehouse, accountRows, products, currency] = await Promise.all([
    o.customerId ? db.customer.findUnique({ where: { id: o.customerId }, select: { id: true } }) : null,
    o.warehouseId ? db.warehouse.findUnique({ where: { id: o.warehouseId }, select: { id: true } }) : null,
    saved.some((t) => t.cashBankAccountId) ? db.cashBankAccount.findMany({ where: { id: { in: saved.map((t) => t.cashBankAccountId).filter(Boolean) } }, select: { id: true, name: true, status: true, currencyId: true } }) : [],
    db.product.findMany({ where: { id: { in: o.items.map((i) => i.productId) } }, select: { id: true } }),
    getDefaultCurrency(),
  ]);
  const problems: string[] = [];
  if (o.customerId && !customer) problems.push(D.posTx.held.resumeCustomer);
  if (o.warehouseId && !warehouse) problems.push(D.posTx.held.resumeWarehouse);
  const accById = new Map(accountRows.map((a) => [a.id, a]));
  const tenders = saved.map((t) => {
    if (!t.cashBankAccountId) return t;
    const acc = accById.get(t.cashBankAccountId);
    if (!acc) problems.push(D.posTx.held.resumeAccount);
    else if (acc.status !== "ACTIVE") problems.push(tr(D, "posTx.held.resumeInactive", { name: acc.name }));
    else if (currency && acc.currencyId !== currency.id) problems.push(tr(D, "posTx.held.resumeCurrency", { name: acc.name }));
    else return t;
    return { ...t, cashBankAccountId: "" };
  });
  const live = new Set(products.map((p) => p.id));
  const lines = o.items.map((i) => ({ productId: i.productId, code: i.productCode, name: i.productName, quantity: i.quantity.toFixed(3).replace(/\.?0+$/, ""), missing: !live.has(i.productId) }));
  for (const l of lines) if (l.missing) problems.push(tr(D, "posTx.held.resumeLine", { code: l.code, name: l.name }));
  return { ok: true, order: { id: o.id, reference: o.reference, customerId: customer ? (o.customerId ?? "") : "", warehouseId: warehouse ? (o.warehouseId ?? "") : "", tenders, notes: o.notes ?? "", lines, problems } };
}

export async function discardHeldOrder(id: unknown): Promise<DiscardResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const t = a.t;
  const NOT_FOUND = t.posTx.held.notFound;
  const hid = heldIdSchema.safeParse(id);
  if (!hid.success) return { ok: false, message: NOT_FOUND };
  // Conditional: only the creator's still-HELD order; archived (kept for audit), never deleted.
  const r = await db.posHeldOrder.updateMany({ where: { id: hid.data, createdById: a.userId, status: "HELD" }, data: { status: "DISCARDED" } });
  if (r.count !== 1) return { ok: false, message: NOT_FOUND };
  return { ok: true, message: t.posTx.held.discarded, orders: await getHeldOrders(a.userId) };
}
