"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { canManageWarehouses } from "@/lib/roles";
import { makeWarehouseSchema, type WarehouseField, type WarehouseInput } from "@/lib/warehouses";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";

export type WarehouseResult =
  | { ok: true; message: string }
  | { ok: false; message: string; fieldErrors?: Partial<Record<WarehouseField, string>> };

const idSchema = z.string().trim().min(1).max(64);

/** OWNER/ADMIN only — re-checked in every mutation; the role never comes from the client. */
async function authorize(t: Dictionary): Promise<WarehouseResult | null> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, message: t.common.sessionExpired };
  if (!canManageWarehouses(session.user.role)) return { ok: false, message: t.warehouses.err.noPermission };
  return null;
}

type Validated = { ok: true; data: WarehouseInput } | { ok: false; error: WarehouseResult };
function validate(input: unknown, t: Dictionary): Validated {
  const parsed = makeWarehouseSchema(t.warehouses.val).safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: Partial<Record<WarehouseField, string>> = {};
  for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as WarehouseField] ??= issue.message;
  return { ok: false, error: { ok: false, message: Object.values(fieldErrors)[0] ?? t.common.checkForm, fieldErrors } };
}

const toData = (d: WarehouseInput) => ({ ...d, zipCode: d.zipCode === "" ? null : d.zipCode });
const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export async function createWarehouse(input: unknown): Promise<WarehouseResult> {
  const t = await getDict();
  const DUPLICATE = t.warehouses.err.duplicate;
  const denied = await authorize(t);
  if (denied) return denied;
  const v = validate(input, t);
  if (!v.ok) return v.error;

  // Name is unique regardless of case (column collation); checked here for a clean message.
  if (await db.warehouse.findUnique({ where: { name: v.data.name }, select: { id: true } })) {
    return { ok: false, message: DUPLICATE, fieldErrors: { name: DUPLICATE } };
  }
  try {
    await db.warehouse.create({ data: toData(v.data) });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, message: DUPLICATE, fieldErrors: { name: DUPLICATE } };
    throw e;
  }
  revalidatePath("/warehouse");
  return { ok: true, message: t.warehouses.ok.created };
}

export async function updateWarehouse(id: unknown, input: unknown): Promise<WarehouseResult> {
  const t = await getDict();
  const DUPLICATE = t.warehouses.err.duplicate;
  const denied = await authorize(t);
  if (denied) return denied;
  const wid = idSchema.safeParse(id);
  if (!wid.success) return { ok: false, message: t.warehouses.err.notFound };
  const v = validate(input, t);
  if (!v.ok) return v.error;

  // The id only selects the row; it is looked up server-side before anything changes.
  const existing = await db.warehouse.findUnique({ where: { id: wid.data }, select: { id: true } });
  if (!existing) return { ok: false, message: t.warehouses.err.notFound };
  const clash = await db.warehouse.findFirst({ where: { name: v.data.name, NOT: { id: existing.id } }, select: { id: true } });
  if (clash) return { ok: false, message: DUPLICATE, fieldErrors: { name: DUPLICATE } };

  try {
    await db.warehouse.update({ where: { id: existing.id }, data: toData(v.data) });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, message: DUPLICATE, fieldErrors: { name: DUPLICATE } };
    throw e;
  }
  revalidatePath("/warehouse");
  return { ok: true, message: t.warehouses.ok.updated };
}

/**
 * Records that would block deleting a warehouse. Sales and purchases don't exist yet; when those
 * modules are added, count their rows for this warehouse here, e.g.
 *   db.sale.count(...), db.purchase.count(...)
 * and also give those relations onDelete: Restrict so the database enforces it too.
 */
async function findWarehouseReferences(warehouseId: string, E: Dictionary["warehouses"]["err"]): Promise<string[]> {
  const pl = (n: number, one: string, many: string) => fmt(n === 1 ? one : many, { n });
  const blockers: string[] = [];
  // Product stock, opening-stock entries and transfers (either direction). FKs are RESTRICT as well.
  const [stocks, entries, transfers, adjustments, expenses, purchases] = await Promise.all([
    db.productStock.count({ where: { warehouseId } }),
    db.productStockEntry.count({ where: { warehouseId } }),
    db.stockTransfer.count({ where: { OR: [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }] } }),
    db.stockAdjustment.count({ where: { warehouseId } }),
    db.expense.count({ where: { warehouseId } }), // including soft-deleted (financial history)
    db.purchase.count({ where: { warehouseId } }),
  ]);
  if (stocks) blockers.push(pl(stocks, E.stock, E.stockMany));
  if (entries) blockers.push(pl(entries, E.entry, E.entryMany));
  if (transfers) blockers.push(pl(transfers, E.transfer, E.transferMany));
  if (adjustments) blockers.push(pl(adjustments, E.adjustment, E.adjustmentMany));
  if (expenses) blockers.push(pl(expenses, E.expense, E.expenseMany));
  if (purchases) blockers.push(pl(purchases, E.purchase, E.purchaseMany));
  const [quotations, sales, saleReturns] = await Promise.all([db.quotation.count({ where: { warehouseId } }), db.sale.count({ where: { warehouseId } }), db.saleReturn.count({ where: { warehouseId } })]);
  if (quotations) blockers.push(pl(quotations, E.quotation, E.quotationMany));
  if (sales) blockers.push(pl(sales, E.sale, E.saleMany));
  if (saleReturns) blockers.push(pl(saleReturns, E.saleReturn, E.saleReturnMany));
  return blockers;
}

export async function deleteWarehouse(id: unknown): Promise<WarehouseResult> {
  const t = await getDict();
  const denied = await authorize(t);
  if (denied) return denied;
  const wid = idSchema.safeParse(id);
  if (!wid.success) return { ok: false, message: t.warehouses.err.notFound };

  const existing = await db.warehouse.findUnique({ where: { id: wid.data }, select: { id: true, name: true } });
  if (!existing) return { ok: false, message: t.warehouses.err.notFound };

  const blockers = await findWarehouseReferences(existing.id, t.warehouses.err);
  if (blockers.length) {
    return { ok: false, message: fmt(t.warehouses.err.blockers, { list: blockers.join(t.warehouses.err.sep) }) };
  }

  try {
    await db.warehouse.delete({ where: { id: existing.id } });
  } catch (e) {
    // A future foreign key (Restrict) would surface here if a reference slipped past the check.
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2003" || e.code === "P2014")) {
      return { ok: false, message: t.warehouses.err.inUse };
    }
    throw e;
  }
  revalidatePath("/warehouse");
  return { ok: true, message: t.warehouses.ok.deleted };
}
