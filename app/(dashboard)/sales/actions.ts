"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { todayLocal } from "@/lib/cash-bank";
import { canManageSales } from "@/lib/roles";
import { SaleError, deductStock } from "@/lib/sale-stock";
import { getDefaultCurrency } from "@/lib/settings";
import { toUnits } from "@/lib/transfers";
import { calcSale, formatSaleReference, saleInputSchema, type SaleField, type SaleInput } from "@/lib/sales";

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
const NO_CURRENCY = "No default currency is configured. The Owner must choose one in System Settings before sales can be recorded.";

const isKnown = (e: unknown, ...codes: string[]) => e instanceof Prisma.PrismaClientKnownRequestError && codes.includes(e.code);
const dateOnly = (v: string) => new Date(`${v}T00:00:00.000Z`);
const txOptions = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 } as const;

async function authorize(): Promise<{ userId: string } | { error: SaleResult }> {
  const s = await auth();
  if (!s?.user?.id) return { error: { ok: false, message: "Your session has expired. Please sign in again." } };
  if (!canManageSales(s.user.role)) return { error: { ok: false, message: "You don't have permission to manage sales." } };
  return { userId: s.user.id };
}

function parse(input: unknown): { ok: true; data: SaleInput } | { ok: false; error: SaleResult } {
  const v = saleInputSchema.safeParse(input);
  if (v.success) return { ok: true, data: v.data };
  const fieldErrors: Partial<Record<SaleField, string>> = {};
  const itemErrors: Record<string, string> = {};
  const raw = (input && typeof input === "object" ? (input as { items?: unknown }).items : undefined) as { productId?: unknown }[] | undefined;
  for (const i of v.error.issues) {
    const [k, index] = i.path;
    if (k === "items" && typeof index === "number" && Array.isArray(raw) && typeof raw[index]?.productId === "string") itemErrors[raw[index].productId as string] ??= i.message;
    fieldErrors[(k as SaleField) ?? "items"] ??= i.message;
  }
  return { ok: false, error: { ok: false, message: Object.values(fieldErrors)[0] ?? "Please check the form", fieldErrors, itemErrors } };
}

type StockLine = { productId: string; quantity: string; productCode: string; productName: string };

/** Re-read references and compute the authoritative totals + line snapshots. */
async function prepare(d: SaleInput): Promise<{ ok: true; lines: Prisma.SaleItemCreateWithoutSaleInput[]; stock: StockLine[]; totals: ReturnType<typeof calcSale> } | { ok: false; error: SaleResult }> {
  const [customer, warehouse, products] = await Promise.all([
    db.customer.findUnique({ where: { id: d.customerId }, select: { id: true } }),
    db.warehouse.findUnique({ where: { id: d.warehouseId }, select: { id: true } }),
    db.product.findMany({ where: { id: { in: d.items.map((i) => i.productId) } }, select: { id: true, code: true, name: true, saleUnit: { select: { name: true } } } }),
  ]);
  if (!customer) return { ok: false, error: { ok: false, message: "Choose a valid customer", fieldErrors: { customerId: "Choose a valid customer" } } };
  if (!warehouse) return { ok: false, error: { ok: false, message: "Choose a valid warehouse", fieldErrors: { warehouseId: "Choose a valid warehouse" } } };
  const byId = new Map(products.map((p) => [p.id, p]));
  const missing = d.items.find((i) => !byId.has(i.productId));
  if (missing) return { ok: false, error: { ok: false, message: "A product in the sale no longer exists", fieldErrors: { items: "A product in the sale no longer exists" }, itemErrors: { [missing.productId]: "This product no longer exists" } } };

  const totals = calcSale(d.items, { orderTaxRate: d.orderTaxRate, discount: d.discount, shipping: d.shipping });
  const bad = totals.lines.findIndex((l) => l.error);
  if (bad >= 0) {
    const msg = totals.lines[bad].error!;
    return { ok: false, error: { ok: false, message: msg, fieldErrors: { items: msg }, itemErrors: { [d.items[bad].productId]: msg } } };
  }
  if (totals.error) return { ok: false, error: { ok: false, message: totals.error, fieldErrors: { discount: totals.error } } };
  if (toUnits(totals.grandTotal, 2) > MAX_TOTAL || toUnits(totals.subtotal, 2) > MAX_TOTAL) return { ok: false, error: { ok: false, message: "The sale total is too large", fieldErrors: { items: "The sale total is too large" } } };

  const lines = d.items.map((i, n) => {
    const p = byId.get(i.productId)!;
    return {
      product: { connect: { id: p.id } },
      productCode: p.code,
      productName: p.name,
      unitName: p.saleUnit.name,
      quantity: i.quantity,
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
  const stock = d.items.map((i) => ({ productId: i.productId, quantity: i.quantity, productCode: byId.get(i.productId)!.code, productName: byId.get(i.productId)!.name }));
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

function fail(e: unknown): SaleResult {
  if (e instanceof SaleError) return { ok: false, message: e.message, fieldErrors: e.itemId ? { items: e.message } : undefined, itemErrors: e.itemId ? { [e.itemId]: e.message } : undefined };
  if (isKnown(e, "P2003", "P2025")) return { ok: false, message: "A selected customer, warehouse or product no longer exists. Refresh and try again." };
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
  const v = parse(input);
  if (!v.ok) return v.error;
  const d = v.data;
  const currency = await getDefaultCurrency();
  if (!currency) return { ok: false, message: NO_CURRENCY };
  const p = await prepare(d);
  if (!p.ok) return p.error;

  try {
    const created = await withRetry(() =>
      db.$transaction(async (tx) => {
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
            ...(d.status === "COMPLETED" ? { completedAt: new Date(), completedById: a.userId } : {}),
            items: { create: p.lines },
          },
          select: { id: true, number: true },
        });
        const reference = formatSaleReference(s0.number);
        await tx.sale.update({ where: { id: s0.id }, data: { reference } });
        if (d.status === "COMPLETED") await deductStock(tx, d.warehouseId, p.stock);
        return { id: s0.id, reference };
      }, txOptions),
    );
    revalidate(created.id);
    return { ok: true, message: `Sale ${created.reference} created${d.status === "COMPLETED" ? " — stock deducted from the warehouse" : " as Pending — no stock deducted yet"}`, id: created.id };
  } catch (e) {
    return fail(e);
  }
}

/** Edit a PENDING sale (header + lines replaced). Saving it as Completed deducts stock in the same transaction. */
export async function updateSale(id: unknown, input: unknown): Promise<SaleResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const sid = idSchema.safeParse(id);
  if (!sid.success) return { ok: false, message: "Sale not found" };
  const v = parse(input);
  if (!v.ok) return v.error;
  const d = v.data;
  const p = await prepare(d);
  if (!p.ok) return p.error;

  try {
    const r = await withRetry(() =>
      db.$transaction(async (tx) => {
        const s = await lockSale(tx, sid.data);
        if (!s) throw new SaleError("Sale not found");
        if (s.status !== "PENDING") throw new SaleError(`Sale ${s.reference} is Completed and can no longer be edited.`);
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
            ...(d.status === "COMPLETED" ? { completedAt: new Date(), completedById: a.userId } : {}),
            items: { create: p.lines },
          },
        });
        if (d.status === "COMPLETED") await deductStock(tx, d.warehouseId, p.stock);
        return s;
      }, txOptions),
    );
    revalidate(sid.data, r.quotationId);
    return { ok: true, message: `Sale ${r.reference} updated${d.status === "COMPLETED" ? " and completed — stock deducted from the warehouse" : ""}`, id: sid.data };
  } catch (e) {
    return fail(e);
  }
}

/** PENDING → COMPLETED: re-reads the stored lines and deducts stock exactly once (or refuses). */
export async function completeSale(id: unknown): Promise<SaleResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const sid = idSchema.safeParse(id);
  if (!sid.success) return { ok: false, message: "Sale not found" };
  try {
    const r = await withRetry(() =>
      db.$transaction(async (tx) => {
        const s = await lockSale(tx, sid.data);
        if (!s) throw new SaleError("Sale not found");
        if (s.status !== "PENDING") throw new SaleError(`Sale ${s.reference} has already been completed.`);
        const items = await tx.saleItem.findMany({ where: { saleId: s.id }, select: { productId: true, quantity: true, productCode: true, productName: true } });
        await tx.sale.update({ where: { id: s.id }, data: { status: "COMPLETED", completedAt: new Date(), completedById: a.userId } });
        await deductStock(tx, s.warehouseId, items);
        return s;
      }, txOptions),
    );
    revalidate(r.id, r.quotationId);
    return { ok: true, message: `Sale ${r.reference} completed — stock deducted from the warehouse` };
  } catch (e) {
    return fail(e);
  }
}

/** Delete a PENDING sale (no stock was deducted). Its reference is never reused. */
export async function deleteSale(id: unknown): Promise<SaleResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const sid = idSchema.safeParse(id);
  if (!sid.success) return { ok: false, message: "Sale not found" };
  try {
    const r = await db.$transaction(async (tx) => {
      const s = await lockSale(tx, sid.data);
      if (!s) throw new SaleError("Sale not found");
      if (s.status !== "PENDING") throw new SaleError(`Sale ${s.reference} is Completed and can't be deleted.`);
      await tx.sale.delete({ where: { id: s.id } }); // lines cascade
      return s;
    }, txOptions);
    revalidate(undefined, r.quotationId);
    return { ok: true, message: `Sale ${r.reference} deleted` };
  } catch (e) {
    return fail(e);
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
  if (!qid.success) return { ok: false, message: "Quotation not found" };
  try {
    const created = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM quotations WHERE id = ${qid.data} FOR UPDATE`;
      const q = await tx.quotation.findUnique({ where: { id: qid.data }, include: { items: { orderBy: { id: "asc" } }, sale: { select: { reference: true } } } });
      if (!q) throw new SaleError("Quotation not found");
      if (q.status !== "ACCEPTED") throw new SaleError(`Only accepted quotations can be converted to a sale (${q.reference} is ${q.status.toLowerCase()}).`);
      if (q.sale) throw new SaleError(`Quotation ${q.reference} has already been converted to sale ${q.sale.reference}.`);
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
    return { ok: true, message: `Sale ${created.reference} created as Pending from quotation ${created.quotationRef} — no stock deducted yet`, id: created.id };
  } catch (e) {
    if (isKnown(e, "P2002")) return { ok: false, message: "This quotation has already been converted to a sale." };
    return fail(e);
  }
}
