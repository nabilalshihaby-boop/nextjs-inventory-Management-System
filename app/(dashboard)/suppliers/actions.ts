"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { canManageSuppliers } from "@/lib/roles";
import { supplierInputSchema, type SupplierField, type SupplierInput } from "@/lib/suppliers";

export type SupplierResult =
  | { ok: true; message: string }
  | { ok: false; message: string; fieldErrors?: Partial<Record<SupplierField, string>> };

const idSchema = z.string().trim().min(1).max(64);
const DUPLICATE = "A supplier with this name already exists";

/** OWNER/ADMIN only — re-checked in every mutation; the role never comes from the client. */
async function authorize(): Promise<SupplierResult | null> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, message: "Your session has expired. Please sign in again." };
  if (!canManageSuppliers(session.user.role)) return { ok: false, message: "You don't have permission to change suppliers." };
  return null;
}

type Validated = { ok: true; data: SupplierInput } | { ok: false; error: SupplierResult };
function validate(input: unknown): Validated {
  const parsed = supplierInputSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: Partial<Record<SupplierField, string>> = {};
  for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as SupplierField] ??= issue.message;
  return { ok: false, error: { ok: false, message: Object.values(fieldErrors)[0] ?? "Please check the form", fieldErrors } };
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export async function createSupplier(input: unknown): Promise<SupplierResult> {
  const denied = await authorize();
  if (denied) return denied;
  const v = validate(input);
  if (!v.ok) return v.error;

  // Name is unique regardless of case (column collation); checked here for a clean message.
  if (await db.supplier.findUnique({ where: { name: v.data.name }, select: { id: true } })) {
    return { ok: false, message: DUPLICATE, fieldErrors: { name: DUPLICATE } };
  }
  try {
    await db.supplier.create({ data: v.data });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, message: DUPLICATE, fieldErrors: { name: DUPLICATE } };
    throw e;
  }
  revalidatePath("/suppliers");
  return { ok: true, message: "Supplier created" };
}

export async function updateSupplier(id: unknown, input: unknown): Promise<SupplierResult> {
  const denied = await authorize();
  if (denied) return denied;
  const sid = idSchema.safeParse(id);
  if (!sid.success) return { ok: false, message: "Supplier not found" };
  const v = validate(input);
  if (!v.ok) return v.error;

  // The id only selects the row; it is looked up server-side before anything changes.
  const existing = await db.supplier.findUnique({ where: { id: sid.data }, select: { id: true } });
  if (!existing) return { ok: false, message: "Supplier not found" };
  const clash = await db.supplier.findFirst({ where: { name: v.data.name, NOT: { id: existing.id } }, select: { id: true } });
  if (clash) return { ok: false, message: DUPLICATE, fieldErrors: { name: DUPLICATE } };

  try {
    await db.supplier.update({ where: { id: existing.id }, data: v.data });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, message: DUPLICATE, fieldErrors: { name: DUPLICATE } };
    throw e;
  }
  revalidatePath("/suppliers");
  return { ok: true, message: "Supplier updated" };
}

/**
 * Records that would block deleting a supplier. Purchases, purchase returns and supplier payments
 * don't exist yet; when they do, count their rows here, e.g.
 *   db.purchase.count({ where: { supplierId } }), db.supplierPayment.count({ where: { supplierId } })
 * and give those relations onDelete: Restrict so the database enforces it as well.
 */
async function findSupplierReferences(supplierId: string): Promise<string[]> {
  const blockers: string[] = [];
  // Opening-stock entries from the Products module (FK is RESTRICT as well).
  const entries = await db.productStockEntry.count({ where: { supplierId } });
  if (entries) blockers.push(`${entries} stock entr${entries === 1 ? "y" : "ies"}`);
  return blockers;
}

export async function deleteSupplier(id: unknown): Promise<SupplierResult> {
  const denied = await authorize();
  if (denied) return denied;
  const sid = idSchema.safeParse(id);
  if (!sid.success) return { ok: false, message: "Supplier not found" };

  const existing = await db.supplier.findUnique({ where: { id: sid.data }, select: { id: true } });
  if (!existing) return { ok: false, message: "Supplier not found" };

  const blockers = await findSupplierReferences(existing.id);
  if (blockers.length) return { ok: false, message: `This supplier can't be deleted because it still has ${blockers.join(", ")}.` };

  try {
    await db.supplier.delete({ where: { id: existing.id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2003" || e.code === "P2014")) {
      return { ok: false, message: "This supplier can't be deleted because other records still use it." };
    }
    throw e;
  }
  revalidatePath("/suppliers");
  return { ok: true, message: "Supplier deleted" };
}
