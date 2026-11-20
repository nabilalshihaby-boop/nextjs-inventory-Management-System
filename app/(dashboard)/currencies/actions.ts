"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { canManageCurrencies } from "@/lib/roles";
import { SETTINGS_ID } from "@/lib/settings";
import { currencyInputSchema, type CurrencyField, type CurrencyInput } from "@/lib/currencies";

export type CurrencyResult =
  | { ok: true; message: string }
  | { ok: false; message: string; fieldErrors?: Partial<Record<CurrencyField, string>> };

const idSchema = z.string().trim().min(1).max(64);
const DUPLICATE = "A currency with this code already exists";

/** OWNER/ADMIN only — re-checked in every mutation; the role never comes from the client. */
async function authorize(): Promise<CurrencyResult | null> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, message: "Your session has expired. Please sign in again." };
  if (!canManageCurrencies(session.user.role)) return { ok: false, message: "You don't have permission to change currencies." };
  return null;
}

type Validated = { ok: true; data: CurrencyInput } | { ok: false; error: CurrencyResult };

function validate(input: unknown): Validated {
  const parsed = currencyInputSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: Partial<Record<CurrencyField, string>> = {};
  for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as CurrencyField] ??= issue.message;
  return { ok: false, error: { ok: false, message: Object.values(fieldErrors)[0] ?? "Please check the form", fieldErrors } };
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export async function createCurrency(input: unknown): Promise<CurrencyResult> {
  const denied = await authorize();
  if (denied) return denied;
  const v = validate(input);
  if (!v.ok) return v.error;

  // Codes are stored uppercase and the column is case-insensitive: any case variant is a duplicate.
  if (await db.currency.findUnique({ where: { code: v.data.code }, select: { id: true } })) {
    return { ok: false, message: DUPLICATE, fieldErrors: { code: DUPLICATE } };
  }
  try {
    await db.currency.create({ data: v.data });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, message: DUPLICATE, fieldErrors: { code: DUPLICATE } };
    throw e;
  }
  revalidatePath("/currencies");
  return { ok: true, message: "Currency created" };
}

export async function updateCurrency(id: unknown, input: unknown): Promise<CurrencyResult> {
  const denied = await authorize();
  if (denied) return denied;
  const cid = idSchema.safeParse(id);
  if (!cid.success) return { ok: false, message: "Currency not found" };
  const v = validate(input);
  if (!v.ok) return v.error;

  // The id only selects the row; it is looked up server-side before anything changes.
  const existing = await db.currency.findUnique({ where: { id: cid.data }, select: { id: true } });
  if (!existing) return { ok: false, message: "Currency not found" };
  const clash = await db.currency.findFirst({ where: { code: v.data.code, NOT: { id: existing.id } }, select: { id: true } });
  if (clash) return { ok: false, message: DUPLICATE, fieldErrors: { code: DUPLICATE } };

  try {
    await db.currency.update({ where: { id: existing.id }, data: v.data });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, message: DUPLICATE, fieldErrors: { code: DUPLICATE } };
    throw e;
  }
  revalidatePath("/currencies");
  return { ok: true, message: "Currency updated" };
}

export async function deleteCurrency(id: unknown): Promise<CurrencyResult> {
  const denied = await authorize();
  if (denied) return denied;
  const cid = idSchema.safeParse(id);
  if (!cid.success) return { ok: false, message: "Currency not found" };

  const existing = await db.currency.findUnique({ where: { id: cid.data }, select: { id: true } });
  if (!existing) return { ok: false, message: "Currency not found" };

  // The System Settings default currency is protected (also enforced by the RESTRICT foreign key).
  const settings = await db.systemSettings.findUnique({ where: { id: SETTINGS_ID }, select: { defaultCurrencyId: true } });
  const PROTECTED = "This currency is the default currency in System Settings. Choose another default currency first.";
  if (settings?.defaultCurrencyId === existing.id) return { ok: false, message: PROTECTED };

  try {
    await db.currency.delete({ where: { id: existing.id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2003" || e.code === "P2014")) {
      return { ok: false, message: PROTECTED };
    }
    throw e;
  }
  revalidatePath("/currencies");
  return { ok: true, message: "Currency deleted" };
}
