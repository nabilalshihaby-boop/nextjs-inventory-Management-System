"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { canManageQuotations } from "@/lib/roles";
import { getDefaultCurrency } from "@/lib/settings";
import { toUnits } from "@/lib/transfers";
import {
  QUOTATION_STATUSES,
  QUOTATION_STATUS_LABEL,
  calcQuotation,
  canTransition,
  formatQuotationReference,
  quotationInputSchema,
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
const NO_CURRENCY = "No default currency is configured. The Owner must choose one in System Settings before quotations can be created.";

class QuotationError extends Error {}
const isKnown = (e: unknown, ...codes: string[]) => e instanceof Prisma.PrismaClientKnownRequestError && codes.includes(e.code);
const dateOnly = (v: string) => new Date(`${v}T00:00:00.000Z`);

async function authorize(): Promise<{ userId: string } | { error: QuotationResult }> {
  const s = await auth();
  if (!s?.user?.id) return { error: { ok: false, message: "Your session has expired. Please sign in again." } };
  if (!canManageQuotations(s.user.role)) return { error: { ok: false, message: "You don't have permission to manage quotations." } };
  return { userId: s.user.id };
}

function parse(input: unknown): { ok: true; data: QuotationInput } | { ok: false; error: QuotationResult } {
  const v = quotationInputSchema.safeParse(input);
  if (v.success) return { ok: true, data: v.data };
  const fieldErrors: Partial<Record<QuotationField, string>> = {};
  const itemErrors: Record<string, string> = {};
  const raw = (input && typeof input === "object" ? (input as { items?: unknown }).items : undefined) as { productId?: unknown }[] | undefined;
  for (const i of v.error.issues) {
    const [k, index] = i.path;
    if (k === "items" && typeof index === "number" && Array.isArray(raw) && typeof raw[index]?.productId === "string") itemErrors[raw[index].productId as string] ??= i.message;
    fieldErrors[(k as QuotationField) ?? "items"] ??= i.message;
  }
  return { ok: false, error: { ok: false, message: Object.values(fieldErrors)[0] ?? "Please check the form", fieldErrors, itemErrors } };
}

/** Re-read references and compute the authoritative totals + line snapshots. */
async function prepare(d: QuotationInput): Promise<{ ok: true; data: Prisma.QuotationItemCreateWithoutQuotationInput[]; totals: ReturnType<typeof calcQuotation> } | { ok: false; error: QuotationResult }> {
  const [customer, warehouse, products] = await Promise.all([
    db.customer.findUnique({ where: { id: d.customerId }, select: { id: true } }),
    db.warehouse.findUnique({ where: { id: d.warehouseId }, select: { id: true } }),
    db.product.findMany({ where: { id: { in: d.items.map((i) => i.productId) } }, select: { id: true, code: true, name: true, saleUnit: { select: { name: true } } } }),
  ]);
  if (!customer) return { ok: false, error: { ok: false, message: "Choose a valid customer", fieldErrors: { customerId: "Choose a valid customer" } } };
  if (!warehouse) return { ok: false, error: { ok: false, message: "Choose a valid warehouse", fieldErrors: { warehouseId: "Choose a valid warehouse" } } };
  const byId = new Map(products.map((p) => [p.id, p]));
  const missing = d.items.find((i) => !byId.has(i.productId));
  if (missing) return { ok: false, error: { ok: false, message: "A product in the quotation no longer exists", fieldErrors: { items: "A product in the quotation no longer exists" }, itemErrors: { [missing.productId]: "This product no longer exists" } } };

  const totals = calcQuotation(d.items, { orderTaxRate: d.orderTaxRate, discount: d.discount, shipping: d.shipping });
  const bad = totals.lines.findIndex((l) => l.error);
  if (bad >= 0) {
    const msg = totals.lines[bad].error!;
    return { ok: false, error: { ok: false, message: msg, fieldErrors: { items: msg }, itemErrors: { [d.items[bad].productId]: msg } } };
  }
  if (totals.error) return { ok: false, error: { ok: false, message: totals.error, fieldErrors: { discount: totals.error } } };
  if (toUnits(totals.grandTotal, 2) > MAX_TOTAL || toUnits(totals.subtotal, 2) > MAX_TOTAL) return { ok: false, error: { ok: false, message: "The quotation total is too large", fieldErrors: { items: "The quotation total is too large" } } };

  const items = d.items.map((i, n) => {
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
  const v = parse(input);
  if (!v.ok) return v.error;
  const d = v.data;
  const currency = await getDefaultCurrency();
  if (!currency) return { ok: false, message: NO_CURRENCY };
  const p = await prepare(d);
  if (!p.ok) return p.error;

  try {
    const created = await db.$transaction(async (tx) => {
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
    return { ok: true, message: `Quotation ${created.reference} created as Draft`, id: created.id };
  } catch (e) {
    if (isKnown(e, "P2003", "P2025")) return { ok: false, message: "A selected customer, warehouse or product no longer exists. Refresh and try again." };
    throw e;
  }
}

/** Edit a DRAFT quotation: header + lines are replaced; reference, currency and status are kept. */
export async function updateQuotation(id: unknown, input: unknown): Promise<QuotationResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const qid = idSchema.safeParse(id);
  if (!qid.success) return { ok: false, message: "Quotation not found" };
  const v = parse(input);
  if (!v.ok) return v.error;
  const d = v.data;
  const p = await prepare(d);
  if (!p.ok) return p.error;

  try {
    const ref = await db.$transaction(async (tx) => {
      const q = await lockQuotation(tx, qid.data);
      if (!q) throw new QuotationError("Quotation not found");
      if (q.status !== "DRAFT") throw new QuotationError(`Quotation ${q.reference} is ${QUOTATION_STATUS_LABEL[q.status]} and can no longer be edited. Only draft quotations can be edited.`);
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
    return { ok: true, message: `Quotation ${ref} updated`, id: qid.data };
  } catch (e) {
    if (e instanceof QuotationError) return { ok: false, message: e.message };
    if (isKnown(e, "P2003", "P2025")) return { ok: false, message: "A selected customer, warehouse or product no longer exists. Refresh and try again." };
    throw e;
  }
}

/** Delete a DRAFT quotation (its reference number is never reused). */
export async function deleteQuotation(id: unknown): Promise<QuotationResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const qid = idSchema.safeParse(id);
  if (!qid.success) return { ok: false, message: "Quotation not found" };
  try {
    const ref = await db.$transaction(async (tx) => {
      const q = await lockQuotation(tx, qid.data);
      if (!q) throw new QuotationError("Quotation not found");
      if (q.status !== "DRAFT") throw new QuotationError(`Quotation ${q.reference} is ${QUOTATION_STATUS_LABEL[q.status]} and can't be deleted. Only draft quotations can be deleted.`);
      await tx.quotation.delete({ where: { id: q.id } }); // lines cascade
      return q.reference;
    });
    revalidate();
    return { ok: true, message: `Quotation ${ref} deleted` };
  } catch (e) {
    if (e instanceof QuotationError) return { ok: false, message: e.message };
    throw e;
  }
}

/** DRAFT → SENT; SENT → ACCEPTED | REJECTED | EXPIRED. Anything else is refused. */
export async function changeQuotationStatus(id: unknown, to: unknown): Promise<QuotationResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const qid = idSchema.safeParse(id);
  if (!qid.success) return { ok: false, message: "Quotation not found" };
  const target = statusSchema.safeParse(to);
  if (!target.success) return { ok: false, message: "Choose a valid status" };
  try {
    const r = await db.$transaction(async (tx) => {
      const q = await lockQuotation(tx, qid.data);
      if (!q) throw new QuotationError("Quotation not found");
      const from = q.status as QuotationStatusValue;
      if (!canTransition(from, target.data)) throw new QuotationError(`A ${QUOTATION_STATUS_LABEL[from]} quotation can't be marked as ${QUOTATION_STATUS_LABEL[target.data]}.`);
      await tx.quotation.update({ where: { id: q.id }, data: { status: target.data, statusChangedAt: new Date(), statusChangedById: a.userId } });
      return q.reference;
    });
    revalidate(qid.data);
    return { ok: true, message: `Quotation ${r} marked as ${QUOTATION_STATUS_LABEL[target.data]}` };
  } catch (e) {
    if (e instanceof QuotationError) return { ok: false, message: e.message };
    throw e;
  }
}
