"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { canManageCustomers } from "@/lib/roles";
import { customerInputSchema, type CustomerField, type CustomerInput } from "@/lib/customers";

export type CustomerResult =
  | { ok: true; message: string }
  | { ok: false; message: string; fieldErrors?: Partial<Record<CustomerField, string>> };

const idSchema = z.string().trim().min(1).max(64);
const DUPLICATE = "A customer with this name already exists";

/** OWNER/ADMIN only — re-checked in every mutation; the role never comes from the client. */
async function authorize(): Promise<CustomerResult | null> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, message: "Your session has expired. Please sign in again." };
  if (!canManageCustomers(session.user.role)) return { ok: false, message: "You don't have permission to change customers." };
  return null;
}

type Validated = { ok: true; data: CustomerInput } | { ok: false; error: CustomerResult };
function validate(input: unknown): Validated {
  const parsed = customerInputSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: Partial<Record<CustomerField, string>> = {};
  for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as CustomerField] ??= issue.message;
  return { ok: false, error: { ok: false, message: Object.values(fieldErrors)[0] ?? "Please check the form", fieldErrors } };
}

const toData = (d: CustomerInput) => ({
  name: d.name,
  email: d.email,
  phoneNumber: d.phoneNumber,
  countryCode: d.countryCode,
  city: d.city,
  address: d.address,
  dateOfBirth: d.dateOfBirth ? new Date(`${d.dateOfBirth}T00:00:00.000Z`) : null,
});

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const duplicate = (): CustomerResult => ({ ok: false, message: DUPLICATE, fieldErrors: { name: DUPLICATE } });

export async function createCustomer(input: unknown): Promise<CustomerResult> {
  const denied = await authorize();
  if (denied) return denied;
  const v = validate(input);
  if (!v.ok) return v.error;

  // Name is unique regardless of case (column collation); checked here for a clean message.
  if (await db.customer.findUnique({ where: { name: v.data.name }, select: { id: true } })) return duplicate();
  try {
    await db.customer.create({ data: toData(v.data) });
  } catch (e) {
    if (isUniqueViolation(e)) return duplicate();
    throw e;
  }
  revalidatePath("/customers");
  return { ok: true, message: "Customer created" };
}

export async function updateCustomer(id: unknown, input: unknown): Promise<CustomerResult> {
  const denied = await authorize();
  if (denied) return denied;
  const cid = idSchema.safeParse(id);
  if (!cid.success) return { ok: false, message: "Customer not found" };
  const v = validate(input);
  if (!v.ok) return v.error;

  // The id only selects the row; it is looked up server-side before anything changes.
  const existing = await db.customer.findUnique({ where: { id: cid.data }, select: { id: true } });
  if (!existing) return { ok: false, message: "Customer not found" };
  if (await db.customer.findFirst({ where: { name: v.data.name, NOT: { id: existing.id } }, select: { id: true } })) return duplicate();

  try {
    await db.customer.update({ where: { id: existing.id }, data: toData(v.data) });
  } catch (e) {
    if (isUniqueViolation(e)) return duplicate();
    throw e;
  }
  revalidatePath("/customers");
  return { ok: true, message: "Customer updated" };
}

/**
 * Records that would block deleting a customer. Quotations and sales reference customers
 * (onDelete: Restrict as well). When Customer Payments are added, count their rows here too.
 */
async function findCustomerReferences(customerId: string): Promise<string[]> {
  const blockers: string[] = [];
  const [quotations, sales, saleReturns, payments] = await Promise.all([db.quotation.count({ where: { customerId } }), db.sale.count({ where: { customerId } }), db.saleReturn.count({ where: { customerId } }), db.customerPayment.count({ where: { customerId } })]);
  if (quotations) blockers.push(`${quotations} quotation${quotations === 1 ? "" : "s"}`);
  if (sales) blockers.push(`${sales} sale${sales === 1 ? "" : "s"}`);
  if (saleReturns) blockers.push(`${saleReturns} sales return${saleReturns === 1 ? "" : "s"}`);
  if (payments) blockers.push(`${payments} customer payment${payments === 1 ? "" : "s"}`);
  return blockers;
}

export async function deleteCustomer(id: unknown): Promise<CustomerResult> {
  const denied = await authorize();
  if (denied) return denied;
  const cid = idSchema.safeParse(id);
  if (!cid.success) return { ok: false, message: "Customer not found" };

  const existing = await db.customer.findUnique({ where: { id: cid.data }, select: { id: true } });
  if (!existing) return { ok: false, message: "Customer not found" };

  // The POS Walk-in Customer setting must never point at a deleted customer (the database also refuses).
  const walkIn = await db.systemSettings.findFirst({ where: { posWalkInCustomerId: existing.id }, select: { id: true } });
  if (walkIn) return { ok: false, message: "This customer is the POS Walk-in Customer. Choose another (or none) in System Settings before deleting it." };

  const blockers = await findCustomerReferences(existing.id);
  if (blockers.length) return { ok: false, message: `This customer can't be deleted because it still has ${blockers.join(", ")}.` };

  try {
    await db.customer.delete({ where: { id: existing.id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2003" || e.code === "P2014")) {
      return { ok: false, message: "This customer can't be deleted because other records still use it." };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return { ok: false, message: "Customer not found" };
    throw e;
  }
  revalidatePath("/customers");
  return { ok: true, message: "Customer deleted" };
}
