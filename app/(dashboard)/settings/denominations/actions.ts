"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { makeDenominationSchemas } from "@/lib/denominations";
import { getDict } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n";
import { canManageSystemSettings } from "@/lib/roles";

// Cash denominations per currency (Settings). OWNER or ADMIN only - auth() and the role are re-read in every
// action (never from the client); payloads are strict Zod; the currency is looked up in the database.
// Nothing is seeded. A denomination used by a closed register count is never deleted (inactivate it) and
// its value is frozen; closed sessions keep their own snapshot rows, so history can never change.

export type DenominationResult = { ok: true; message: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };

async function authorize(): Promise<DenominationResult | null> {
  const s = await auth();
  const t = await getDict();
  if (!s?.user?.id) return { ok: false, message: t.common.sessionExpired };
  if (!canManageSystemSettings(s.user)) return { ok: false, message: t.denom.err.onlyOwner };
  return null;
}
function invalid(error: { issues: { path: PropertyKey[]; code: string; message: string }[] }, t: Dictionary): DenominationResult {
  const fieldErrors: Record<string, string> = {};
  for (const i of error.issues) fieldErrors[String(i.path[0] ?? "form")] ??= i.code === "unrecognized_keys" ? t.common.unexpectedFields : i.message;
  return { ok: false, message: Object.values(fieldErrors)[0] ?? t.common.checkForm, fieldErrors };
}
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const usedCount = (denominationId: string) => db.cashRegisterCount.count({ where: { denominationId } });
const done = (message: string): DenominationResult => {
  revalidatePath("/settings/denominations");
  revalidatePath("/pos");
  return { ok: true, message };
};

export async function createDenomination(input: unknown): Promise<DenominationResult> {
  const denied = await authorize();
  if (denied) return denied;
    const t = await getDict();
  const S = makeDenominationSchemas(t.denom.val);
  const DUP = t.denom.err.duplicate;
  const v = S.denominationCreateSchema.safeParse(input);
  if (!v.success) return invalid(v.error, t);
  const d = v.data;
  const currency = await db.currency.findUnique({ where: { id: d.currencyId }, select: { id: true } });
  if (!currency) return { ok: false, message: t.denom.err.noCurrency, fieldErrors: { currencyId: t.denom.err.noCurrency } };
  try {
    await db.currencyDenomination.create({ data: { currencyId: currency.id, value: d.value, label: d.label || null } });
  } catch (e) {
    if (isUnique(e)) return { ok: false, message: DUP, fieldErrors: { value: DUP } };
    throw e;
  }
  return done(t.denom.ok.added);
}

export async function updateDenomination(id: unknown, input: unknown): Promise<DenominationResult> {
  const denied = await authorize();
  if (denied) return denied;
    const t = await getDict();
  const S = makeDenominationSchemas(t.denom.val);
  const DUP = t.denom.err.duplicate;
  const did = S.denominationIdSchema.safeParse(id);
  if (!did.success) return { ok: false, message: t.denom.val.notFound };
  const v = S.denominationUpdateSchema.safeParse(input);
  if (!v.success) return invalid(v.error, t);
  const d = v.data;
  const cur = await db.currencyDenomination.findUnique({ where: { id: did.data }, select: { id: true, value: true } });
    if (!cur) return { ok: false, message: t.denom.val.notFound };
  if (!cur.value.equals(d.value) && (await usedCount(cur.id)) > 0) {
        const msg = t.denom.err.frozen;
    return { ok: false, message: msg, fieldErrors: { value: msg } };
  }
  try {
    await db.currencyDenomination.update({ where: { id: cur.id }, data: { value: d.value, label: d.label || null, active: d.active } });
  } catch (e) {
    if (isUnique(e)) return { ok: false, message: DUP, fieldErrors: { value: DUP } };
    throw e;
  }
  return done(d.active ? t.denom.ok.saved : t.denom.ok.savedInactive);
}

export async function deleteDenomination(id: unknown): Promise<DenominationResult> {
  const denied = await authorize();
  if (denied) return denied;
    const t = await getDict();
  const did = makeDenominationSchemas(t.denom.val).denominationIdSchema.safeParse(id);
  if (!did.success) return { ok: false, message: t.denom.val.notFound };
  const cur = await db.currencyDenomination.findUnique({ where: { id: did.data }, select: { id: true } });
  if (!cur) return { ok: false, message: t.denom.val.notFound };
  if ((await usedCount(cur.id)) > 0) return { ok: false, message: t.denom.err.deleteUsed };
  await db.currencyDenomination.delete({ where: { id: cur.id } });
  return done(t.denom.ok.deleted);
}
