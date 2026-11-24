"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { canManageCurrencies } from "@/lib/roles";
import { SETTINGS_ID } from "@/lib/settings";
import { makeCurrencySchema, type CurrencyField, type CurrencyInput } from "@/lib/currencies";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";

export type CurrencyResult =
  | { ok: true; message: string }
  | { ok: false; message: string; fieldErrors?: Partial<Record<CurrencyField, string>> };

const idSchema = z.string().trim().min(1).max(64);

/** OWNER/ADMIN only — re-checked in every mutation; the role never comes from the client. */
async function authorize(t: Dictionary): Promise<CurrencyResult | null> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, message: t.common.sessionExpired };
  if (!canManageCurrencies(session.user)) return { ok: false, message: t.currencies.err.noPermission };
  return null;
}

type Validated = { ok: true; data: CurrencyInput } | { ok: false; error: CurrencyResult };

function validate(input: unknown, t: Dictionary): Validated {
  const parsed = makeCurrencySchema(t.currencies.val).safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: Partial<Record<CurrencyField, string>> = {};
  for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as CurrencyField] ??= issue.message;
  return { ok: false, error: { ok: false, message: Object.values(fieldErrors)[0] ?? t.common.checkForm, fieldErrors } };
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export async function createCurrency(input: unknown): Promise<CurrencyResult> {
  const t = await getDict();
  const DUPLICATE = t.currencies.err.duplicate;
  const denied = await authorize(t);
  if (denied) return denied;
  const v = validate(input, t);
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
  return { ok: true, message: t.currencies.ok.created };
}

export async function updateCurrency(id: unknown, input: unknown): Promise<CurrencyResult> {
  const t = await getDict();
  const DUPLICATE = t.currencies.err.duplicate;
  const denied = await authorize(t);
  if (denied) return denied;
  const cid = idSchema.safeParse(id);
  if (!cid.success) return { ok: false, message: t.currencies.err.notFound };
  const v = validate(input, t);
  if (!v.ok) return v.error;

  // The id only selects the row; it is looked up server-side before anything changes.
  const existing = await db.currency.findUnique({ where: { id: cid.data }, select: { id: true } });
  if (!existing) return { ok: false, message: t.currencies.err.notFound };
  const clash = await db.currency.findFirst({ where: { code: v.data.code, NOT: { id: existing.id } }, select: { id: true } });
  if (clash) return { ok: false, message: DUPLICATE, fieldErrors: { code: DUPLICATE } };

  try {
    await db.currency.update({ where: { id: existing.id }, data: v.data });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, message: DUPLICATE, fieldErrors: { code: DUPLICATE } };
    throw e;
  }
  revalidatePath("/currencies");
  return { ok: true, message: t.currencies.ok.updated };
}

export async function deleteCurrency(id: unknown): Promise<CurrencyResult> {
  const t = await getDict();
  const E = t.currencies.err;
  const denied = await authorize(t);
  if (denied) return denied;
  const cid = idSchema.safeParse(id);
  if (!cid.success) return { ok: false, message: E.notFound };

  const existing = await db.currency.findUnique({ where: { id: cid.data }, select: { id: true } });
  if (!existing) return { ok: false, message: E.notFound };

  // The System Settings default currency is protected (also enforced by the RESTRICT foreign key).
  const settings = await db.systemSettings.findUnique({ where: { id: SETTINGS_ID }, select: { defaultCurrencyId: true } });
  if (settings?.defaultCurrencyId === existing.id) return { ok: false, message: E.protectedDefault };
  const used = (n: number, one: string, many: string): CurrencyResult => ({ ok: false, message: fmt(E.usedBy, { n, what: n === 1 ? one : many }) });
  // Cash & bank accounts keep their currency (RESTRICT foreign key as well).
  const [accounts, purchases, payments] = await Promise.all([db.cashBankAccount.count({ where: { currencyId: existing.id } }), db.purchase.count({ where: { currencyId: existing.id } }), db.supplierPayment.count({ where: { currencyId: existing.id } })]);
  if (accounts) return used(accounts, E.account, E.accounts);
  if (purchases) return used(purchases, E.purchase, E.purchases);
  if (payments) return used(payments, E.payment, E.payments);
  const denoms = await db.currencyDenomination.count({ where: { currencyId: existing.id } });
  if (denoms) return { ok: false, message: fmt(E.hasDenoms, { n: denoms, what: denoms === 1 ? E.denomination : E.denominations }) };
  const quotations = await db.quotation.count({ where: { currencyId: existing.id } });
  if (quotations) return used(quotations, E.quotation, E.quotations);
  const sales = await db.sale.count({ where: { currencyId: existing.id } });
  if (sales) return used(sales, E.sale, E.sales);
  const saleReturns = await db.saleReturn.count({ where: { currencyId: existing.id } });
  if (saleReturns) return used(saleReturns, E.saleReturn, E.saleReturns);
  const customerPayments = await db.customerPayment.count({ where: { currencyId: existing.id } });
  if (customerPayments) return used(customerPayments, E.customerPayment, E.customerPayments);

  try {
    await db.currency.delete({ where: { id: existing.id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2003" || e.code === "P2014")) {
      return { ok: false, message: E.stillUsed };
    }
    throw e;
  }
  revalidatePath("/currencies");
  return { ok: true, message: t.currencies.ok.deleted };
}
