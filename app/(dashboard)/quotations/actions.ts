"use server";

import { InactiveProductError, assertKeptLines, assertProductsActive, inactiveProductRefusal, sameDecimal } from "@/lib/product-status";
import { recordScopeError, scopeError } from "@/lib/access-scope";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { canManageQuotations } from "@/lib/roles";
import { getDefaultCurrency } from "@/lib/settings";
import { getDict } from "@/lib/i18n/server";
import { LocalizedError, errorMessage, tr, type Vars } from "@/lib/i18n/messages";
import type { Dictionary } from "@/lib/i18n";
import { toUnits } from "@/lib/transfers";
import {
  QUOTATION_STATUSES,
  calcQuotation,
  canTransition,
  formatQuotationReference,
  makeQuotationSchema,
  type QuotationField,
  type QuotationInput,
  type QuotationStatusValue,
} from "@/lib/quotations";

// Quotations. Integrity rules (server-side):
// - OWNER/ADMIN only; auth() is re-read in every action and the role never comes from the client.
// - Customer, warehouse and products are re-read from MySQL; every amount (line discount, tax,
//   subtotal, order tax, grand total) is recomputed with the shared exact calculation — client
//   totals are ignored. Each line stores its own snapshot (price, tax, discount, product code/name,
//   unit); the Product row is NEVER updated. The currency is the System Settings default currency
//   at creation (kept unchanged when a draft is edited).
// - NO stock, cash/bank, ledger, purchase-due or customer-balance changes anywhere in this file.
// - Status, reference and currency are server-owned. New quotations are DRAFT. Only DRAFT can be
//   edited or deleted; DRAFT → SENT → ACCEPTED | REJECTED | EXPIRED. Every edit/delete/transition
//   locks the row (SELECT … FOR UPDATE) and re-checks the status in the same transaction.

export type QuotationResult =
  | { ok: true; message: string; id?: string }
  | { ok: false; message: string; fieldErrors?: Partial<Record<QuotationField, string>>; itemErrors?: Record<string, string> };

const idSchema = z.string().trim().min(1).max(64);
const statusSchema = z.enum(QUOTATION_STATUSES);
const MAX_TOTAL = toUnits("999999999999.99", 2);

// Carries a dictionary key (+ variables); translated with the request dictionary in each catch.
class QuotationError extends LocalizedError {
  constructor(key: string, vars: Vars = {}) {
    super(key, vars);
  }
}
const isKnown = (e: unknown, ...codes: string[]) => e instanceof Prisma.PrismaClientKnownRequestError && codes.includes(e.code);
const dateOnly = (v: string) => new Date(`${v}T00:00:00.000Z`);

async function authorize(): Promise<{ userId: string; t: Dictionary } | { error: QuotationResult }> {
  const s = await auth();
  const t = await getDict();
  if (!s?.user?.id) return { error: { ok: false, message: t.common.sessionExpired } };
  if (!canManageQuotations(s.user)) return { error: { ok: false, message: t.quotations.err.noPermission } };
  return { userId: s.user.id, t };
}

function parse(input: unknown, t: Dictionary): { ok: true; data: QuotationInput } | { ok: false; error: QuotationResult } {
  const v = makeQuotationSchema(t.quotations.val).safeParse(input);
  if (v.success) return { ok: true, data: v.data };
  const fieldErrors: Partial<Record<QuotationField, string>> = {};
  const itemErrors: Record<string, string> = {};
  const raw = (input && typeof input === "object" ? (input as { items?: unknown }).items : undefined) as { productId?: unknown }[] | undefined;
  for (const i of v.error.issues) {
    const [k, index] = i.path;
    if (k === "items" && typeof index === "number" && Array.isArray(raw) && typeof raw[index]?.productId === "string") itemErrors[raw[index].productId as string] ??= i.message;
    fieldErrors[(k as QuotationField) ?? "items"] ??= i.message;
  }
  return { ok: false, error: { ok: false, message: Object.values(fieldErrors)[0] ?? t.common.checkForm, fieldErrors, itemErrors } };
}

/** The stored lines of an edited quotation: what a line of a product that is now inactive must still equal. */
const storedLineSelect = { productId: true, unitName: true, quantity: true, unitPrice: true, taxType: true, taxRate: true, discountType: true, discountValue: true } as const;
type StoredLine = Prisma.QuotationItemGetPayload<{ select: typeof storedLineSelect }>;
const sameQuotationLine = (l: QuotationInput["items"][number], s: StoredLine) =>
  sameDecimal(l.quantity, s.quantity) && sameDecimal(l.unitPrice, s.unitPrice) && l.taxType === s.taxType && sameDecimal(l.taxRate, s.taxRate) && l.discountType === s.discountType && sameDecimal(l.discountValue, s.discountValue);

/** Re-read references and compute the authoritative totals + line snapshots. */
async function prepare(d: QuotationInput, t: Dictionary, existing?: { lines: StoredLine[]; warehouseId: string }): Promise<{ ok: true; data: Prisma.QuotationItemCreateWithoutQuotationInput[]; totals: ReturnType<typeof calcQuotation> } | { ok: false; error: QuotationResult }> {
  const [customer, warehouse, products] = await Promise.all([
    db.customer.findUnique({ where: { id: d.customerId }, select: { id: true } }),
    db.warehouse.findUnique({ where: { id: d.warehouseId }, select: { id: true } }),
    db.product.findMany({ where: { id: { in: d.items.map((i) => i.productId) } }, select: { id: true, code: true, name: true, productUnitId: true, productUnit: { select: { name: true } } } }),
  ]);
  if (!customer) return { ok: false, error: { ok: false, message: t.quotations.err.invalidCustomer, fieldErrors: { customerId: t.quotations.err.invalidCustomer } } };
  if (!warehouse) return { ok: false, error: { ok: false, message: t.quotations.err.invalidWarehouse, fieldErrors: { warehouseId: t.quotations.err.invalidWarehouse } } };
  const byId = new Map(products.map((p) => [p.id, p]));
  const missing = d.items.find((i) => !byId.has(i.productId));
  if (missing) return { ok: false, error: { ok: false, message: t.quotations.err.productGone, fieldErrors: { items: t.quotations.err.productGone }, itemErrors: { [missing.productId]: t.quotations.err.itemGone } } };
  // An inactive product can't start a new quotation line. An edited quotation may keep its existing line unchanged.
  const kept = new Map<string, StoredLine>();
  if (!existing) {
    const refused = await inactiveProductRefusal(db, d.items.map((i) => i.productId), t);
    if (refused) return { ok: false, error: { ok: false, message: refused.message, fieldErrors: { items: refused.message }, itemErrors: { [refused.productId]: refused.message } } };
  } else {
    try {
      const k = await assertKeptLines(db, d.items, existing.lines, sameQuotationLine, d.warehouseId !== existing.warehouseId);
      for (const [id, rows] of k) kept.set(id, rows[0]);
    } catch (e) {
      if (!(e instanceof InactiveProductError)) throw e;
      const message = errorMessage(t, e);
      return { ok: false, error: { ok: false, message, fieldErrors: { items: message }, itemErrors: { [e.itemId!]: message } } };
    }
  }

  // Quotations are Base Unit only: a line may omit unitId or send the product's own base unit id; any other (pack) unit is refused.
  const packed = d.items.find((i) => i.unitId && i.unitId !== byId.get(i.productId)!.productUnitId);
  if (packed) {
    const msg = tr(t, "units.err.notAllowed", { unit: packed.unitId, product: byId.get(packed.productId)!.code });
    return { ok: false, error: { ok: false, message: msg, fieldErrors: { items: msg }, itemErrors: { [packed.productId]: msg } } };
  }

  const totals = calcQuotation(d.items, { orderTaxRate: d.orderTaxRate, discount: d.discount, shipping: d.shipping });
  const bad = totals.lines.findIndex((l) => l.error);
  if (bad >= 0) {
    const msg = totals.lines[bad].errorKey ? tr(t, totals.lines[bad].errorKey!) : totals.lines[bad].error!;
    return { ok: false, error: { ok: false, message: msg, fieldErrors: { items: msg }, itemErrors: { [d.items[bad].productId]: msg } } };
  }
  if (totals.error) {
    const msg = totals.errorKey ? tr(t, totals.errorKey) : totals.error;
    return { ok: false, error: { ok: false, message: msg, fieldErrors: { discount: msg } } };
  }
  if (toUnits(totals.grandTotal, 2) > MAX_TOTAL || toUnits(totals.subtotal, 2) > MAX_TOTAL) return { ok: false, error: { ok: false, message: t.quotations.err.totalTooLarge, fieldErrors: { items: t.quotations.err.totalTooLarge } } };

  const items = d.items.map((i, n) => {
    const p = byId.get(i.productId)!;
    return {
      product: { connect: { id: p.id } },
      productCode: p.code,
      productName: p.name,
      unitName: kept.get(p.id)?.unitName ?? p.productUnit.name,
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
  return { ok: true, data: items, totals };
}

function revalidate(id?: string) {
  revalidatePath("/quotations");
  if (id) revalidatePath(`/quotations/${id}`);
}

/** Lock the quotation row and re-read its status (inside a transaction). */
async function lockQuotation(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM quotations WHERE id = ${id} FOR UPDATE`;
  return tx.quotation.findUnique({ where: { id }, select: { id: true, reference: true, status: true } });
}

export async function createQuotation(input: unknown): Promise<QuotationResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const t = a.t;
  const v = parse(input, t);
  if (!v.ok) return v.error;
  const d = v.data;
  const scopeMsg = await scopeError([d.warehouseId]);
  if (scopeMsg) return { ok: false, message: scopeMsg };
  const currency = await getDefaultCurrency();
  if (!currency) return { ok: false, message: t.quotations.err.noCurrency };
  const p = await prepare(d, t);
  if (!p.ok) return p.error;

  try {
    const created = await db.$transaction(async (tx) => {
      await assertProductsActive(tx, d.items.map((i) => i.productId));
      const q0 = await tx.quotation.create({
        data: {
          reference: `TMP_${randomBytes(8).toString("hex")}`, // replaced below, inside this transaction
          quotationDate: dateOnly(d.quotationDate),
          customer: { connect: { id: d.customerId } },
          warehouse: { connect: { id: d.warehouseId } },
          status: "DRAFT",
          currency: { connect: { id: currency.id } },
          subtotal: p.totals.subtotal,
          orderTaxRate: d.orderTaxRate,
          orderTaxAmount: p.totals.orderTaxAmount,
          discount: d.discount,
          shipping: d.shipping,
          grandTotal: p.totals.grandTotal,
          notes: d.notes || null,
          createdById: a.userId,
          items: { create: p.data },
        },
        select: { id: true, number: true },
      });
      const reference = formatQuotationReference(q0.number);
      await tx.quotation.update({ where: { id: q0.id }, data: { reference } });
      return { id: q0.id, reference };
    });
    revalidate(created.id);
    return { ok: true, message: tr(t, "quotations.ok.created", { ref: created.reference }), id: created.id };
  } catch (e) {
    if (e instanceof InactiveProductError) return { ok: false, message: errorMessage(t, e) };
    if (isKnown(e, "P2003", "P2025")) return { ok: false, message: t.quotations.err.refsGone };
    throw e;
  }
}

/** Edit a DRAFT quotation: header + lines are replaced; reference, currency and status are kept. */
export async function updateQuotation(id: unknown, input: unknown): Promise<QuotationResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const t = a.t;
  const qid = idSchema.safeParse(id);
  if (!qid.success) return { ok: false, message: t.quotations.err.notFound };
  const scopeRec = await recordScopeError("quotation", qid.data);
  if (scopeRec) return { ok: false, message: scopeRec };
  const v = parse(input, t);
  if (!v.ok) return v.error;
  const d = v.data;
  const scopeMsg = await scopeError([d.warehouseId]);
  if (scopeMsg) return { ok: false, message: scopeMsg };
  const header = await db.quotation.findUnique({ where: { id: qid.data }, select: { warehouseId: true, items: { select: storedLineSelect } } });
  const p = await prepare(d, t, header ? { lines: header.items, warehouseId: header.warehouseId } : undefined);
  if (!p.ok) return p.error;

  try {
    const ref = await db.$transaction(async (tx) => {
      const q = await lockQuotation(tx, qid.data);
      if (!q) throw new QuotationError("quotations.err.notFound");
      if (q.status !== "DRAFT") throw new QuotationError("quotations.err.noEdit", { ref: q.reference, status: tr(a.t, `quotations.status.${q.status}`) });
      const storedNow = await tx.quotationItem.findMany({ where: { quotationId: q.id }, select: storedLineSelect });
      const before = await tx.quotation.findUniqueOrThrow({ where: { id: q.id }, select: { warehouseId: true } });
      await assertKeptLines(tx, d.items, storedNow, sameQuotationLine, before.warehouseId !== d.warehouseId);
      await tx.quotationItem.deleteMany({ where: { quotationId: q.id } });
      await tx.quotation.update({
        where: { id: q.id },
        data: {
          quotationDate: dateOnly(d.quotationDate),
          customer: { connect: { id: d.customerId } },
          warehouse: { connect: { id: d.warehouseId } },
          subtotal: p.totals.subtotal,
          orderTaxRate: d.orderTaxRate,
          orderTaxAmount: p.totals.orderTaxAmount,
          discount: d.discount,
          shipping: d.shipping,
          grandTotal: p.totals.grandTotal,
          notes: d.notes || null,
          items: { create: p.data },
        },
      });
      return q.reference;
    });
    revalidate(qid.data);
    return { ok: true, message: tr(t, "quotations.ok.updated", { ref }), id: qid.data };
  } catch (e) {
    if (e instanceof QuotationError || e instanceof InactiveProductError) return { ok: false, message: errorMessage(a.t, e) };
    if (isKnown(e, "P2003", "P2025")) return { ok: false, message: t.quotations.err.refsGone };
    throw e;
  }
}

/** Delete a DRAFT quotation (its reference number is never reused). */
export async function deleteQuotation(id: unknown): Promise<QuotationResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const qid = idSchema.safeParse(id);
  if (!qid.success) return { ok: false, message: a.t.quotations.err.notFound };
  const scopeRec = await recordScopeError("quotation", qid.data);
  if (scopeRec) return { ok: false, message: scopeRec };
  try {
    const ref = await db.$transaction(async (tx) => {
      const q = await lockQuotation(tx, qid.data);
      if (!q) throw new QuotationError("quotations.err.notFound");
      if (q.status !== "DRAFT") throw new QuotationError("quotations.err.noDelete", { ref: q.reference, status: tr(a.t, `quotations.status.${q.status}`) });
      await tx.quotation.delete({ where: { id: q.id } }); // lines cascade
      return q.reference;
    });
    revalidate();
    return { ok: true, message: tr(a.t, "quotations.ok.deleted", { ref }) };
  } catch (e) {
    if (e instanceof QuotationError || e instanceof InactiveProductError) return { ok: false, message: errorMessage(a.t, e) };
    throw e;
  }
}

/** DRAFT → SENT; SENT → ACCEPTED | REJECTED | EXPIRED. Anything else is refused. */
export async function changeQuotationStatus(id: unknown, to: unknown): Promise<QuotationResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const qid = idSchema.safeParse(id);
  if (!qid.success) return { ok: false, message: a.t.quotations.err.notFound };
  const scopeRec = await recordScopeError("quotation", qid.data);
  if (scopeRec) return { ok: false, message: scopeRec };
  const target = statusSchema.safeParse(to);
  if (!target.success) return { ok: false, message: a.t.quotations.err.chooseStatus };
  try {
    const r = await db.$transaction(async (tx) => {
      const q = await lockQuotation(tx, qid.data);
      if (!q) throw new QuotationError("quotations.err.notFound");
      const from = q.status as QuotationStatusValue;
      if (!canTransition(from, target.data)) throw new QuotationError("quotations.err.badTransition", { from: tr(a.t, `quotations.status.${from}`), to: tr(a.t, `quotations.status.${target.data}`) });
      await tx.quotation.update({ where: { id: q.id }, data: { status: target.data, statusChangedAt: new Date(), statusChangedById: a.userId } });
      return q.reference;
    });
    revalidate(qid.data);
    return { ok: true, message: tr(a.t, "quotations.ok.marked", { ref: r, status: tr(a.t, `quotations.status.${target.data}`) }) };
  } catch (e) {
    if (e instanceof QuotationError || e instanceof InactiveProductError) return { ok: false, message: errorMessage(a.t, e) };
    throw e;
  }
}
