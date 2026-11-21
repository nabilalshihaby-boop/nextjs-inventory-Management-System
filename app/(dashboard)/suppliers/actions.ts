"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { canManageSuppliers } from "@/lib/roles";
import { makeSupplierSchema, type SupplierField, type SupplierInput } from "@/lib/suppliers";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";

export type SupplierResult =
  | { ok: true; message: string }
  | { ok: false; message: string; fieldErrors?: Partial<Record<SupplierField, string>> };

const idSchema = z.string().trim().min(1).max(64);

/** OWNER/ADMIN only — re-checked in every mutation; the role never comes from the client. */
async function authorize(): Promise<SupplierResult | null> {
  const session = await auth();
  const t = await getDict();
  if (!session?.user?.id) return { ok: false, message: t.common.sessionExpired };
  if (!canManageSuppliers(session.user.role)) return { ok: false, message: t.suppliers.err.noPermission };
  return null;
}

type Validated = { ok: true; data: SupplierInput } | { ok: false; error: SupplierResult };
function validate(input: unknown, t: Dictionary): Validated {
  const parsed = makeSupplierSchema(t.suppliers.val).safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: Partial<Record<SupplierField, string>> = {};
  for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as SupplierField] ??= issue.message;
  return { ok: false, error: { ok: false, message: Object.values(fieldErrors)[0] ?? t.common.checkForm, fieldErrors } };
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export async function createSupplier(input: unknown): Promise<SupplierResult> {
  const denied = await authorize();
  if (denied) return denied;
  const t = await getDict();
  const DUPLICATE = t.suppliers.err.duplicate;
  const v = validate(input, t);
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
  return { ok: true, message: t.suppliers.ok.created };
}

export async function updateSupplier(id: unknown, input: unknown): Promise<SupplierResult> {
  const denied = await authorize();
  if (denied) return denied;
  const t = await getDict();
  const DUPLICATE = t.suppliers.err.duplicate;
  const sid = idSchema.safeParse(id);
  if (!sid.success) return { ok: false, message: t.suppliers.err.notFound };
  const v = validate(input, t);
  if (!v.ok) return v.error;

  // The id only selects the row; it is looked up server-side before anything changes.
  const existing = await db.supplier.findUnique({ where: { id: sid.data }, select: { id: true } });
  if (!existing) return { ok: false, message: t.suppliers.err.notFound };
  const clash = await db.supplier.findFirst({ where: { name: v.data.name, NOT: { id: existing.id } }, select: { id: true } });
  if (clash) return { ok: false, message: DUPLICATE, fieldErrors: { name: DUPLICATE } };

  try {
    await db.supplier.update({ where: { id: existing.id }, data: v.data });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, message: DUPLICATE, fieldErrors: { name: DUPLICATE } };
    throw e;
  }
  revalidatePath("/suppliers");
  return { ok: true, message: t.suppliers.ok.updated };
}

/**
 * Records that would block deleting a supplier: opening-stock entries and purchases (both FKs are
 * RESTRICT as well). Purchase returns and supplier payments don't exist yet; when they do, count
 * their rows here too, e.g. db.supplierPayment.count({ where: { supplierId } }).
 */
async function findSupplierReferences(supplierId: string): Promise<string[]> {
  const blockers: string[] = [];
  const [entries, purchases, payments] = await Promise.all([db.productStockEntry.count({ where: { supplierId } }), db.purchase.count({ where: { supplierId } }), db.supplierPayment.count({ where: { supplierId } })]);
  const E = (await getDict()).suppliers.err;
  if (entries) blockers.push(fmt(entries === 1 ? E.stockEntry : E.stockEntries, { n: entries }));
  if (purchases) blockers.push(fmt(purchases === 1 ? E.purchase : E.purchases, { n: purchases }));
  if (payments) blockers.push(fmt(payments === 1 ? E.payment : E.payments, { n: payments }));
  return blockers;
}

export async function deleteSupplier(id: unknown): Promise<SupplierResult> {
  const denied = await authorize();
  if (denied) return denied;
  const T = await getDict();
  const sid = idSchema.safeParse(id);
  if (!sid.success) return { ok: false, message: T.suppliers.err.notFound };

  const existing = await db.supplier.findUnique({ where: { id: sid.data }, select: { id: true } });
  if (!existing) return { ok: false, message: T.suppliers.err.notFound };

  const blockers = await findSupplierReferences(existing.id);
  if (blockers.length) return { ok: false, message: fmt(T.suppliers.err.blockers, { list: blockers.join(T.suppliers.err.sep) }) };

  try {
    await db.supplier.delete({ where: { id: existing.id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2003" || e.code === "P2014")) {
      return { ok: false, message: T.suppliers.err.inUse };
    }
    throw e;
  }
  revalidatePath("/suppliers");
  return { ok: true, message: T.suppliers.ok.deleted };
}
