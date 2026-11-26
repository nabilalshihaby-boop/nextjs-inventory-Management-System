"use server";

import { recordScopeError, scopeError } from "@/lib/access-scope";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { todayLocal } from "@/lib/cash-bank";
import { canManageSales } from "@/lib/roles";
import { getDict } from "@/lib/i18n/server";
import { errorMessage, tr } from "@/lib/i18n/messages";
import type { Dictionary } from "@/lib/i18n";
import { SaleError, deductStock } from "@/lib/sale-stock";
import { StockHistoryError } from "@/lib/stock-history-guard";
import { InactiveProductError, assertKeptLines, assertProductsActive, inactiveProductRefusal, sameDecimal, sameUnit } from "@/lib/product-status";
import { lineSnapshot, loadUnitSets, resolveLine, type ResolvedUnit } from "@/lib/product-units";
import { getDefaultCurrency } from "@/lib/settings";
import { toUnits } from "@/lib/transfers";
import { calcSale, formatSaleReference, makeSaleSchema, type SaleField, type SaleInput } from "@/lib/sales";

// Sales — the shared sales engine (future POS must call these same rules, not its own stock logic).
// Integrity rules (server-side):
// - OWNER/ADMIN only; auth() is re-read in every action and the role never comes from the client.
// - Customer, warehouse and products are re-read; every amount is recomputed with the shared exact
//   calculation. Lines store their own snapshot; the Product row is NEVER updated.
// - Reference, currency (System Settings default), paid (always 0 — no customer payments yet) and
//   totals are server-owned. NO cash/bank, ledger, payment or customer-balance rows are written.
// - Stock: PENDING changes nothing. Becoming COMPLETED (on create, on edit, or "Mark as Completed")
//   deducts every line from the sale's warehouse in the SAME transaction, with a conditional
//   UPDATE … WHERE quantity >= n per product (stable product-id order). If any line lacks stock the
//   whole transaction rolls back — no partial deduction. The sale row is locked (FOR UPDATE) and its
//   status re-checked, so concurrent completions deduct exactly once.
// - Only PENDING sales can be edited or deleted. COMPLETED sales are immutable (no reversal).
// - An ACCEPTED quotation converts once into a PENDING sale from its server-side snapshot
//   (quotation row locked + unique Sale.quotationId), with no stock change until completed.

export type SaleResult =
  | { ok: true; message: string; id?: string }
  | { ok: false; message: string; fieldErrors?: Partial<Record<SaleField, string>>; itemErrors?: Record<string, string> };

const idSchema = z.string().trim().min(1).max(64);
const MAX_TOTAL = toUnits("999999999999.99", 2);

const isKnown = (e: unknown, ...codes: string[]) => e instanceof Prisma.PrismaClientKnownRequestError && codes.includes(e.code);
const dateOnly = (v: string) => new Date(`${v}T00:00:00.000Z`);
const txOptions = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 } as const;

async function authorize(): Promise<{ userId: string; t: Dictionary } | { error: SaleResult }> {
  const s = await auth();
  const t = await getDict();
  if (!s?.user?.id) return { error: { ok: false, message: t.common.sessionExpired } };
  if (!canManageSales(s.user)) return { error: { ok: false, message: t.sales.err.noPermission } };
  return { userId: s.user.id, t };
}

function parse(input: unknown, t: Dictionary): { ok: true; data: SaleInput } | { ok: false; error: SaleResult } {
  const v = makeSaleSchema(t.sales.val).safeParse(input);
  if (v.success) return { ok: true, data: v.data };
  const fieldErrors: Partial<Record<SaleField, string>> = {};
  const itemErrors: Record<string, string> = {};
  const raw = (input && typeof input === "object" ? (input as { items?: unknown }).items : undefined) as { productId?: unknown }[] | undefined;
  for (const i of v.error.issues) {
    const [k, index] = i.path;
    if (k === "items" && typeof index === "number" && Array.isArray(raw) && typeof raw[index]?.productId === "string") itemErrors[raw[index].productId as string] ??= i.message;
    fieldErrors[(k as SaleField) ?? "items"] ??= i.message;
  }
  return { ok: false, error: { ok: false, message: Object.values(fieldErrors)[0] ?? t.common.checkForm, fieldErrors, itemErrors } };
}

type StockLine = { productId: string; quantity: string; productCode: string; productName: string };

/** The stored lines of an edited sale: what a line of a product that is now inactive must still equal. */
const storedLineSelect = { productId: true, unitId: true, unitName: true, unitFactor: true, baseQuantity: true, quantity: true, unitPrice: true, taxType: true, taxRate: true, discountType: true, discountValue: true } as const;
type StoredLine = Prisma.SaleItemGetPayload<{ select: typeof storedLineSelect }>;
const sameSaleLine = (l: SaleInput["items"][number], s: StoredLine) =>
  sameUnit(l.unitId, s.unitId) && sameDecimal(l.quantity, s.quantity) && sameDecimal(l.unitPrice, s.unitPrice) && l.taxType === s.taxType && sameDecimal(l.taxRate, s.taxRate) && l.discountType === s.discountType && sameDecimal(l.discountValue, s.discountValue);

/** Re-read references and compute the authoritative totals + line snapshots. */
async function prepare(d: SaleInput, t: Dictionary, existing?: { lines: StoredLine[]; warehouseId: string }): Promise<{ ok: true; lines: Prisma.SaleItemCreateWithoutSaleInput[]; stock: StockLine[]; totals: ReturnType<typeof calcSale> } | { ok: false; error: SaleResult }> {
  const [customer, warehouse, products] = await Promise.all([
    db.customer.findUnique({ where: { id: d.customerId }, select: { id: true } }),
    db.warehouse.findUnique({ where: { id: d.warehouseId }, select: { id: true } }),
    db.product.findMany({ where: { id: { in: d.items.map((i) => i.productId) } }, select: { id: true, code: true, name: true } }),
  ]);
  if (!customer) return { ok: false, error: { ok: false, message: t.sales.err.invalidCustomer, fieldErrors: { customerId: t.sales.err.invalidCustomer } } };
  if (!warehouse) return { ok: false, error: { ok: false, message: t.sales.err.invalidWarehouse, fieldErrors: { warehouseId: t.sales.err.invalidWarehouse } } };
  const byId = new Map(products.map((p) => [p.id, p]));
  const missing = d.items.find((i) => !byId.has(i.productId));
  if (missing) return { ok: false, error: { ok: false, message: t.sales.err.productGone, fieldErrors: { items: t.sales.err.productGone }, itemErrors: { [missing.productId]: t.sales.err.itemGone } } };
  // An inactive product can't start a new sale line. An edited sale may keep its existing line unchanged: its stored unit snapshot is reused.
  const kept = new Map<string, StoredLine>();
  if (!existing) {
    const refused = await inactiveProductRefusal(db, d.items.map((i) => i.productId), t);
    if (refused) return { ok: false, error: { ok: false, message: refused.message, fieldErrors: { items: refused.message }, itemErrors: { [refused.productId]: refused.message } } };
  } else {
    try {
      const k = await assertKeptLines(db, d.items, existing.lines, sameSaleLine, d.warehouseId !== existing.warehouseId);
      for (const [id, rows] of k) kept.set(id, rows[0]);
    } catch (e) {
      if (!(e instanceof InactiveProductError)) throw e;
      const message = errorMessage(t, e);
      return { ok: false, error: { ok: false, message, fieldErrors: { items: message }, itemErrors: { [e.itemId!]: message } } };
    }
  }

  // Units: every line's unit must be an active SALE conversion of THIS product; factor and base quantity come from MySQL.
  const sets = await loadUnitSets(db, d.items.map((i) => i.productId));
  const lineUnit = new Map<string, ResolvedUnit>();
  const unitErrors: Record<string, string> = {};
  for (const i of d.items) {
    const pr = byId.get(i.productId)!;
    const k = kept.get(i.productId);
    if (k) {
      lineUnit.set(i.productId, { unitId: k.unitId ?? "", unitName: k.unitName, factor: k.unitFactor.toString(), baseQuantity: k.baseQuantity.toFixed(3) });
      continue;
    }
    const r = resolveLine(sets.get(i.productId), i.unitId, "SALE", i.quantity, `${pr.code} ${pr.name}`);
    if (r.ok) lineUnit.set(i.productId, r.r);
    else unitErrors[i.productId] = tr(t, r.f.key, r.f.vars);
  }
  if (Object.keys(unitErrors).length) {
    const m = Object.values(unitErrors)[0];
    return { ok: false, error: { ok: false, message: m, fieldErrors: { items: m }, itemErrors: unitErrors } };
  }

  const totals = calcSale(d.items, { orderTaxRate: d.orderTaxRate, discount: d.discount, shipping: d.shipping });
  const bad = totals.lines.findIndex((l) => l.error);
  if (bad >= 0) {
    const msg = totals.lines[bad].errorKey ? tr(t, totals.lines[bad].errorKey!) : totals.lines[bad].error!;
    return { ok: false, error: { ok: false, message: msg, fieldErrors: { items: msg }, itemErrors: { [d.items[bad].productId]: msg } } };
  }
  if (totals.error) {
    const msg = totals.errorKey ? tr(t, totals.errorKey) : totals.error;
    return { ok: false, error: { ok: false, message: msg, fieldErrors: { discount: msg } } };
  }
  if (toUnits(totals.grandTotal, 2) > MAX_TOTAL || toUnits(totals.subtotal, 2) > MAX_TOTAL) return { ok: false, error: { ok: false, message: t.sales.err.totalTooLarge, fieldErrors: { items: t.sales.err.totalTooLarge } } };

  const lines = d.items.map((i, n) => {
    const p = byId.get(i.productId)!;
    return {
      product: { connect: { id: p.id } },
      productCode: p.code,
      productName: p.name,
      quantity: i.quantity,
      ...lineSnapshot(lineUnit.get(i.productId)!),
      ...(kept.has(i.productId) ? { unitId: kept.get(i.productId)!.unitId } : {}), // a legacy line stays legacy
      unitPrice: i.unitPrice,
      taxType: i.taxType,
      taxRate: i.taxRate,
      discountType: i.discountType,
      discountValue: i.discountValue,
      discountAmount: totals.lines[n].discountAmount,
      taxAmount: totals.lines[n].taxAmount,
      netUnitPrice: totals.lines[n].netUnitCost,
      subtotal: totals.lines[n].subtotal,
    };
  });
  const stock = d.items.map((i) => ({ productId: i.productId, quantity: lineUnit.get(i.productId)!.baseQuantity, productCode: byId.get(i.productId)!.code, productName: byId.get(i.productId)!.name }));
  return { ok: true, lines, stock, totals };
}

async function lockSale(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM sales WHERE id = ${id} FOR UPDATE`;
  return tx.sale.findUnique({ where: { id }, select: { id: true, reference: true, status: true, warehouseId: true, quotationId: true } });
}

function revalidate(id?: string, quotationId?: string | null) {
  revalidatePath("/sales");
  if (id) revalidatePath(`/sales/${id}`);
  revalidatePath("/products"); // In Stock
  if (quotationId) {
    revalidatePath("/quotations");
    revalidatePath(`/quotations/${quotationId}`);
  }
}

function fail(e: unknown, t: Dictionary): SaleResult {
  if (e instanceof SaleError || e instanceof StockHistoryError || e instanceof InactiveProductError) {
    const message = errorMessage(t, e);
    return { ok: false, message, fieldErrors: e.itemId ? { items: message } : undefined, itemErrors: e.itemId ? { [e.itemId]: message } : undefined };
  }
  if (isKnown(e, "P2003", "P2025")) return { ok: false, message: t.sales.err.refsGone };
  throw e;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt < 4 && isKnown(e, "P2034")) continue; // deadlock / write conflict → retry
      throw e;
    }
  }
}

export async function createSale(input: unknown): Promise<SaleResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const v = parse(input, a.t);
  if (!v.ok) return v.error;
  const d = v.data;
  const scopeMsg = await scopeError([d.warehouseId]);
  if (scopeMsg) return { ok: false, message: scopeMsg };
  const currency = await getDefaultCurrency();
  if (!currency) return { ok: false, message: a.t.sales.err.noCurrency };
  const p = await prepare(d, a.t);
  if (!p.ok) return p.error;

  try {
    const created = await withRetry(() =>
      db.$transaction(async (tx) => {
        await assertProductsActive(tx, d.items.map((i) => i.productId));
        const at = new Date(); // the completion moment (stock-out time)
        const s0 = await tx.sale.create({
          data: {
            reference: `TMP_${randomBytes(8).toString("hex")}`, // replaced below, inside this transaction
            saleDate: dateOnly(d.saleDate),
            customer: { connect: { id: d.customerId } },
            warehouse: { connect: { id: d.warehouseId } },
            status: d.status,
            currency: { connect: { id: currency.id } },
            subtotal: p.totals.subtotal,
            orderTaxRate: d.orderTaxRate,
            orderTaxAmount: p.totals.orderTaxAmount,
            discount: d.discount,
            shipping: d.shipping,
            grandTotal: p.totals.grandTotal,
            paidAmount: "0",
            notes: d.notes || null,
            createdById: a.userId,
            ...(d.status === "COMPLETED" ? { completedAt: at, completedById: a.userId } : {}),
            items: { create: p.lines },
          },
          select: { id: true, number: true },
        });
        const reference = formatSaleReference(s0.number);
        await tx.sale.update({ where: { id: s0.id }, data: { reference } });
        if (d.status === "COMPLETED") await deductStock(tx, d.warehouseId, p.stock, at);
        return { id: s0.id, reference };
      }, txOptions),
    );
    revalidate(created.id);
    return { ok: true, message: tr(a.t, d.status === "COMPLETED" ? "sales.ok.createdCompleted" : "sales.ok.createdPending", { ref: created.reference }), id: created.id };
  } catch (e) {
    return fail(e, a.t);
  }
}

/** Edit a PENDING sale (header + lines replaced). Saving it as Completed deducts stock in the same transaction. */
export async function updateSale(id: unknown, input: unknown): Promise<SaleResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const sid = idSchema.safeParse(id);
  if (!sid.success) return { ok: false, message: a.t.sales.err.notFound };
  const scopeRec = await recordScopeError("sale", sid.data);
  if (scopeRec) return { ok: false, message: scopeRec };
  const v = parse(input, a.t);
  if (!v.ok) return v.error;
  const d = v.data;
  const scopeMsg = await scopeError([d.warehouseId]);
  if (scopeMsg) return { ok: false, message: scopeMsg };
  const header = await db.sale.findUnique({ where: { id: sid.data }, select: { warehouseId: true, items: { select: storedLineSelect } } });
  const p = await prepare(d, a.t, header ? { lines: header.items, warehouseId: header.warehouseId } : undefined);
  if (!p.ok) return p.error;

  try {
    const r = await withRetry(() =>
      db.$transaction(async (tx) => {
        const at = new Date(); // the completion moment (stock-out time)
        const s = await lockSale(tx, sid.data);
        if (!s) throw new SaleError("sales.err.notFound");
        if (s.status !== "PENDING") throw new SaleError("sales.err.completedNoEdit", { ref: s.reference });
        const storedNow = await tx.saleItem.findMany({ where: { saleId: s.id }, select: storedLineSelect });
        await assertKeptLines(tx, d.items, storedNow, sameSaleLine, s.warehouseId !== d.warehouseId);
        await tx.saleItem.deleteMany({ where: { saleId: s.id } });
        await tx.sale.update({
          where: { id: s.id },
          data: {
            saleDate: dateOnly(d.saleDate),
            customer: { connect: { id: d.customerId } },
            warehouse: { connect: { id: d.warehouseId } },
            status: d.status,
            subtotal: p.totals.subtotal,
            orderTaxRate: d.orderTaxRate,
            orderTaxAmount: p.totals.orderTaxAmount,
            discount: d.discount,
            shipping: d.shipping,
            grandTotal: p.totals.grandTotal,
            notes: d.notes || null,
            ...(d.status === "COMPLETED" ? { completedAt: at, completedById: a.userId } : {}),
            items: { create: p.lines },
          },
        });
        if (d.status === "COMPLETED") await deductStock(tx, d.warehouseId, p.stock, at);
        return s;
      }, txOptions),
    );
    revalidate(sid.data, r.quotationId);
    return { ok: true, message: tr(a.t, d.status === "COMPLETED" ? "sales.ok.updatedCompleted" : "sales.ok.updated", { ref: r.reference }), id: sid.data };
  } catch (e) {
    return fail(e, a.t);
  }
}

/** PENDING → COMPLETED: re-reads the stored lines and deducts stock exactly once (or refuses). */
export async function completeSale(id: unknown): Promise<SaleResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const sid = idSchema.safeParse(id);
  if (!sid.success) return { ok: false, message: a.t.sales.err.notFound };
  const scopeRec = await recordScopeError("sale", sid.data);
  if (scopeRec) return { ok: false, message: scopeRec };
  try {
    const r = await withRetry(() =>
      db.$transaction(async (tx) => {
        const at = new Date(); // the completion moment (stock-out time)
        const s = await lockSale(tx, sid.data);
        if (!s) throw new SaleError("sales.err.notFound");
        if (s.status !== "PENDING") throw new SaleError("sales.err.alreadyCompleted", { ref: s.reference });
        const stored = await tx.saleItem.findMany({ where: { saleId: s.id }, select: { productId: true, baseQuantity: true, productCode: true, productName: true } });
        const items = stored.map((i) => ({ productId: i.productId, quantity: i.baseQuantity, productCode: i.productCode, productName: i.productName }));
        await tx.sale.update({ where: { id: s.id }, data: { status: "COMPLETED", completedAt: at, completedById: a.userId } });
        await deductStock(tx, s.warehouseId, items, at);
        return s;
      }, txOptions),
    );
    revalidate(r.id, r.quotationId);
    return { ok: true, message: tr(a.t, "sales.ok.completed", { ref: r.reference }) };
  } catch (e) {
    return fail(e, a.t);
  }
}

/** Delete a PENDING sale (no stock was deducted). Its reference is never reused. */
export async function deleteSale(id: unknown): Promise<SaleResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const sid = idSchema.safeParse(id);
  if (!sid.success) return { ok: false, message: a.t.sales.err.notFound };
  const scopeRec = await recordScopeError("sale", sid.data);
  if (scopeRec) return { ok: false, message: scopeRec };
  try {
    const r = await db.$transaction(async (tx) => {
      const s = await lockSale(tx, sid.data);
      if (!s) throw new SaleError("sales.err.notFound");
      if (s.status !== "PENDING") throw new SaleError("sales.err.completedNoDelete", { ref: s.reference });
      await tx.sale.delete({ where: { id: s.id } }); // lines cascade
      return s;
    }, txOptions);
    revalidate(undefined, r.quotationId);
    return { ok: true, message: tr(a.t, "sales.ok.deleted", { ref: r.reference }) };
  } catch (e) {
    return fail(e, a.t);
  }
}

/**
 * ACCEPTED quotation → new PENDING sale, copied from the quotation's stored snapshot (customer,
 * warehouse, currency, notes, lines and totals). The quotation row is locked and Sale.quotationId is
 * unique, so concurrent requests create at most one sale. No stock moves until the sale is completed.
 */
export async function convertQuotationToSale(quotationId: unknown): Promise<SaleResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const qid = idSchema.safeParse(quotationId);
  if (!qid.success) return { ok: false, message: a.t.sales.err.quotationNotFound };
  const scopeRec = await recordScopeError("quotation", qid.data);
  if (scopeRec) return { ok: false, message: scopeRec };
  try {
    const created = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM quotations WHERE id = ${qid.data} FOR UPDATE`;
      const q = await tx.quotation.findUnique({ where: { id: qid.data }, include: { items: { orderBy: { id: "asc" } }, sale: { select: { reference: true } } } });
      if (!q) throw new SaleError("sales.err.quotationNotFound");
      if (q.status !== "ACCEPTED") throw new SaleError("sales.err.quotationNotAccepted", { ref: q.reference, status: tr(a.t, `sales.qStatus.${q.status}`) });
      if (q.sale) throw new SaleError("sales.err.alreadyConverted", { ref: q.reference, sale: q.sale.reference });
      // No product-status check: a quotation made before a product was deactivated converts its EXISTING lines (nothing comes from the client).
      const s0 = await tx.sale.create({
        data: {
          reference: `TMP_${randomBytes(8).toString("hex")}`,
          saleDate: dateOnly(todayLocal()),
          customer: { connect: { id: q.customerId } },
          warehouse: { connect: { id: q.warehouseId } },
          status: "PENDING",
          currency: { connect: { id: q.currencyId } },
          subtotal: q.subtotal,
          orderTaxRate: q.orderTaxRate,
          orderTaxAmount: q.orderTaxAmount,
          discount: q.discount,
          shipping: q.shipping,
          grandTotal: q.grandTotal,
          paidAmount: "0",
          notes: q.notes,
          quotation: { connect: { id: q.id } },
          createdById: a.userId,
          items: {
            create: q.items.map((i) => ({
              product: { connect: { id: i.productId } },
              productCode: i.productCode,
              productName: i.productName,
              unitName: i.unitName,
              quantity: i.quantity,
              unitFactor: "1",
              baseQuantity: i.quantity, // quotation lines are in the product's own unit, factor 1
              unitPrice: i.unitPrice,
              taxType: i.taxType,
              taxRate: i.taxRate,
              discountType: i.discountType,
              discountValue: i.discountValue,
              discountAmount: i.discountAmount,
              taxAmount: i.taxAmount,
              netUnitPrice: i.netUnitPrice,
              subtotal: i.subtotal,
            })),
          },
        },
        select: { id: true, number: true },
      });
      const reference = formatSaleReference(s0.number);
      await tx.sale.update({ where: { id: s0.id }, data: { reference } });
      return { id: s0.id, reference, quotationRef: q.reference };
    }, txOptions);
    revalidate(created.id, qid.data);
    return { ok: true, message: tr(a.t, "sales.ok.converted", { ref: created.reference, quotation: created.quotationRef }), id: created.id };
  } catch (e) {
    if (isKnown(e, "P2002")) return { ok: false, message: a.t.sales.err.alreadyConvertedGeneric };
    return fail(e, a.t);
  }
}
