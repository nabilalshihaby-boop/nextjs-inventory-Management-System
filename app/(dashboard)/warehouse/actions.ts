"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { canManageWarehouses } from "@/lib/roles";
import { warehouseInputSchema, type WarehouseField, type WarehouseInput } from "@/lib/warehouses";

export type WarehouseResult =
  | { ok: true; message: string }
  | { ok: false; message: string; fieldErrors?: Partial<Record<WarehouseField, string>> };

const idSchema = z.string().trim().min(1).max(64);
const DUPLICATE = "A warehouse with this name already exists";

/** OWNER/ADMIN only — re-checked in every mutation; the role never comes from the client. */
async function authorize(): Promise<WarehouseResult | null> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, message: "Your session has expired. Please sign in again." };
  if (!canManageWarehouses(session.user.role)) return { ok: false, message: "You don't have permission to change warehouses." };
  return null;
}

type Validated = { ok: true; data: WarehouseInput } | { ok: false; error: WarehouseResult };
function validate(input: unknown): Validated {
  const parsed = warehouseInputSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: Partial<Record<WarehouseField, string>> = {};
  for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as WarehouseField] ??= issue.message;
  return { ok: false, error: { ok: false, message: Object.values(fieldErrors)[0] ?? "Please check the form", fieldErrors } };
}

const toData = (d: WarehouseInput) => ({ ...d, zipCode: d.zipCode === "" ? null : d.zipCode });
const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export async function createWarehouse(input: unknown): Promise<WarehouseResult> {
  const denied = await authorize();
  if (denied) return denied;
  const v = validate(input);
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
  return { ok: true, message: "Warehouse created" };
}

export async function updateWarehouse(id: unknown, input: unknown): Promise<WarehouseResult> {
  const denied = await authorize();
  if (denied) return denied;
  const wid = idSchema.safeParse(id);
  if (!wid.success) return { ok: false, message: "Warehouse not found" };
  const v = validate(input);
  if (!v.ok) return v.error;

  // The id only selects the row; it is looked up server-side before anything changes.
  const existing = await db.warehouse.findUnique({ where: { id: wid.data }, select: { id: true } });
  if (!existing) return { ok: false, message: "Warehouse not found" };
  const clash = await db.warehouse.findFirst({ where: { name: v.data.name, NOT: { id: existing.id } }, select: { id: true } });
  if (clash) return { ok: false, message: DUPLICATE, fieldErrors: { name: DUPLICATE } };

  try {
    await db.warehouse.update({ where: { id: existing.id }, data: toData(v.data) });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, message: DUPLICATE, fieldErrors: { name: DUPLICATE } };
    throw e;
  }
  revalidatePath("/warehouse");
  return { ok: true, message: "Warehouse updated" };
}

/**
 * Records that would block deleting a warehouse. Sales and purchases don't exist yet; when those
 * modules are added, count their rows for this warehouse here, e.g.
 *   db.sale.count(...), db.purchase.count(...)
 * and also give those relations onDelete: Restrict so the database enforces it too.
 */
async function findWarehouseReferences(warehouseId: string): Promise<string[]> {
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
  if (stocks) blockers.push(`stock for ${stocks} product${stocks === 1 ? "" : "s"}`);
  if (entries) blockers.push(`${entries} stock entr${entries === 1 ? "y" : "ies"}`);
  if (transfers) blockers.push(`${transfers} transfer${transfers === 1 ? "" : "s"}`);
  if (adjustments) blockers.push(`${adjustments} adjustment${adjustments === 1 ? "" : "s"}`);
  if (expenses) blockers.push(`${expenses} expense${expenses === 1 ? "" : "s"}`);
  if (purchases) blockers.push(`${purchases} purchase${purchases === 1 ? "" : "s"}`);
  const [quotations, sales, saleReturns] = await Promise.all([db.quotation.count({ where: { warehouseId } }), db.sale.count({ where: { warehouseId } }), db.saleReturn.count({ where: { warehouseId } })]);
  if (quotations) blockers.push(`${quotations} quotation${quotations === 1 ? "" : "s"}`);
  if (sales) blockers.push(`${sales} sale${sales === 1 ? "" : "s"}`);
  if (saleReturns) blockers.push(`${saleReturns} sales return${saleReturns === 1 ? "" : "s"}`);
  return blockers;
}

export async function deleteWarehouse(id: unknown): Promise<WarehouseResult> {
  const denied = await authorize();
  if (denied) return denied;
  const wid = idSchema.safeParse(id);
  if (!wid.success) return { ok: false, message: "Warehouse not found" };

  const existing = await db.warehouse.findUnique({ where: { id: wid.data }, select: { id: true, name: true } });
  if (!existing) return { ok: false, message: "Warehouse not found" };

  const blockers = await findWarehouseReferences(existing.id);
  if (blockers.length) {
    return { ok: false, message: `This warehouse can't be deleted because it still has ${blockers.join(", ")}.` };
  }

  try {
    await db.warehouse.delete({ where: { id: existing.id } });
  } catch (e) {
    // A future foreign key (Restrict) would surface here if a reference slipped past the check.
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2003" || e.code === "P2014")) {
      return { ok: false, message: "This warehouse can't be deleted because other records still use it." };
    }
    throw e;
  }
  revalidatePath("/warehouse");
  return { ok: true, message: "Warehouse deleted" };
}
