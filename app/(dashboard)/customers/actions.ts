"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { insertCustomer, isUniqueViolation } from "@/lib/customer-create";
import { canManageCustomers } from "@/lib/roles";
import { makeCustomerSchema, type CustomerField, type CustomerInput } from "@/lib/customers";

export type CustomerResult =
  | { ok: true; message: string }
  | { ok: false; message: string; fieldErrors?: Partial<Record<CustomerField, string>> };

const idSchema = z.string().trim().min(1).max(64);

/** OWNER/ADMIN only — re-checked in every mutation; the role never comes from the client. */
async function authorize(): Promise<CustomerResult | null> {
  const session = await auth();
  const t = await getDict();
  if (!session?.user?.id) return { ok: false, message: t.common.sessionExpired };
  if (!canManageCustomers(session.user)) return { ok: false, message: t.customers.err.noPermission };
  return null;
}

type Validated = { ok: true; data: CustomerInput } | { ok: false; error: CustomerResult };
function validate(input: unknown, t: Dictionary): Validated {
  const parsed = makeCustomerSchema(t.customers.val).safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: Partial<Record<CustomerField, string>> = {};
  for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as CustomerField] ??= issue.message;
  return { ok: false, error: { ok: false, message: Object.values(fieldErrors)[0] ?? t.common.checkForm, fieldErrors } };
}

const toDate = (v: string) => (v ? new Date(`${v}T00:00:00.000Z`) : null);
/** A new row stores "" for anything not given (the columns are NOT NULL). */
const toCreate = (d: CustomerInput) => ({
  name: d.name,
  email: d.email ?? "",
  phoneNumber: d.phoneNumber ?? "",
  countryCode: d.countryCode ?? "",
  city: d.city ?? "",
  address: d.address ?? "",
  dateOfBirth: toDate(d.dateOfBirth ?? ""),
});
/** An update writes only what was sent: Prisma leaves an `undefined` column unchanged. */
const toUpdate = ({ dateOfBirth, ...d }: CustomerInput) => ({ ...d, dateOfBirth: dateOfBirth === undefined ? undefined : toDate(dateOfBirth) });

const duplicate = (t: Dictionary): CustomerResult => ({ ok: false, message: t.customers.duplicate, fieldErrors: { name: t.customers.duplicate } });

export async function createCustomer(input: unknown): Promise<CustomerResult> {
  const denied = await authorize();
  if (denied) return denied;
  const t = await getDict();
  const v = validate(input, t);
  if (!v.ok) return v.error;

  if (!(await insertCustomer(toCreate(v.data))).ok) return duplicate(t);
  revalidatePath("/customers");
  return { ok: true, message: t.customers.ok.created };
}

export async function updateCustomer(id: unknown, input: unknown): Promise<CustomerResult> {
  const denied = await authorize();
  if (denied) return denied;
  const t = await getDict();
  const cid = idSchema.safeParse(id);
  if (!cid.success) return { ok: false, message: t.customers.err.notFound };
  const v = validate(input, t);
  if (!v.ok) return v.error;

  // The id only selects the row; it is looked up server-side before anything changes.
  const existing = await db.customer.findUnique({ where: { id: cid.data }, select: { id: true } });
  if (!existing) return { ok: false, message: t.customers.err.notFound };
  if (await db.customer.findFirst({ where: { name: v.data.name, NOT: { id: existing.id } }, select: { id: true } })) return duplicate(t);

  try {
    await db.customer.update({ where: { id: existing.id }, data: toUpdate(v.data) });
  } catch (e) {
    if (isUniqueViolation(e)) return duplicate(t);
    throw e;
  }
  revalidatePath("/customers");
  return { ok: true, message: t.customers.ok.updated };
}

/**
 * Records that would block deleting a customer. Quotations and sales reference customers
 * (onDelete: Restrict as well). When Customer Payments are added, count their rows here too.
 */
async function findCustomerReferences(customerId: string): Promise<string[]> {
  const blockers: string[] = [];
  const [quotations, sales, saleReturns, payments] = await Promise.all([db.quotation.count({ where: { customerId } }), db.sale.count({ where: { customerId } }), db.saleReturn.count({ where: { customerId } }), db.customerPayment.count({ where: { customerId } })]);
  const E = (await getDict()).customers.err;
  if (quotations) blockers.push(fmt(quotations === 1 ? E.quotation : E.quotations, { n: quotations }));
  if (sales) blockers.push(fmt(sales === 1 ? E.sale : E.sales, { n: sales }));
  if (saleReturns) blockers.push(fmt(saleReturns === 1 ? E.saleReturn : E.saleReturns, { n: saleReturns }));
  if (payments) blockers.push(fmt(payments === 1 ? E.payment : E.payments, { n: payments }));
  return blockers;
}

export async function deleteCustomer(id: unknown): Promise<CustomerResult> {
  const denied = await authorize();
  if (denied) return denied;
  const T = await getDict();
  const cid = idSchema.safeParse(id);
  if (!cid.success) return { ok: false, message: T.customers.err.notFound };

  const existing = await db.customer.findUnique({ where: { id: cid.data }, select: { id: true } });
  if (!existing) return { ok: false, message: T.customers.err.notFound };

  // The POS Walk-in Customer setting must never point at a deleted customer (the database also refuses).
  const walkIn = await db.systemSettings.findFirst({ where: { posWalkInCustomerId: existing.id }, select: { id: true } });
  if (walkIn) return { ok: false, message: T.customers.err.walkIn };

  const blockers = await findCustomerReferences(existing.id);
  if (blockers.length) return { ok: false, message: fmt(T.customers.err.blockers, { list: blockers.join(T.customers.err.sep) }) };

  try {
    await db.customer.delete({ where: { id: existing.id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2003" || e.code === "P2014")) {
      return { ok: false, message: T.customers.err.inUse };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return { ok: false, message: T.customers.err.notFound };
    throw e;
  }
  revalidatePath("/customers");
  return { ok: true, message: T.customers.ok.deleted };
}
