"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { denominationCreateSchema, denominationIdSchema, denominationUpdateSchema } from "@/lib/denominations";
import { canManageSystemSettings } from "@/lib/roles";

// Cash denominations per currency (Settings). OWNER only - auth() and the role are re-read in every
// action (never from the client); payloads are strict Zod; the currency is looked up in the database.
// Nothing is seeded. A denomination used by a closed register count is never deleted (inactivate it) and
// its value is frozen; closed sessions keep their own snapshot rows, so history can never change.

export type DenominationResult = { ok: true; message: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };

const DUP = "That currency already has a denomination with this value.";

async function authorize(): Promise<DenominationResult | null> {
  const s = await auth();
  if (!s?.user?.id) return { ok: false, message: "Your session has expired. Please sign in again." };
  if (!canManageSystemSettings(s.user.role)) return { ok: false, message: "Only the owner can manage denominations." };
  return null;
}
function invalid(error: { issues: { path: PropertyKey[]; code: string; message: string }[] }): DenominationResult {
  const fieldErrors: Record<string, string> = {};
  for (const i of error.issues) fieldErrors[String(i.path[0] ?? "form")] ??= i.code === "unrecognized_keys" ? "Unexpected fields were sent" : i.message;
  return { ok: false, message: Object.values(fieldErrors)[0] ?? "Please check the form", fieldErrors };
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
  const v = denominationCreateSchema.safeParse(input);
  if (!v.success) return invalid(v.error);
  const d = v.data;
  const currency = await db.currency.findUnique({ where: { id: d.currencyId }, select: { id: true } });
  if (!currency) return { ok: false, message: "Choose an existing currency", fieldErrors: { currencyId: "Choose an existing currency" } };
  try {
    await db.currencyDenomination.create({ data: { currencyId: currency.id, value: d.value, label: d.label || null } });
  } catch (e) {
    if (isUnique(e)) return { ok: false, message: DUP, fieldErrors: { value: DUP } };
    throw e;
  }
  return done("Denomination added");
}

export async function updateDenomination(id: unknown, input: unknown): Promise<DenominationResult> {
  const denied = await authorize();
  if (denied) return denied;
  const did = denominationIdSchema.safeParse(id);
  if (!did.success) return { ok: false, message: "Denomination not found" };
  const v = denominationUpdateSchema.safeParse(input);
  if (!v.success) return invalid(v.error);
  const d = v.data;
  const cur = await db.currencyDenomination.findUnique({ where: { id: did.data }, select: { id: true, value: true } });
  if (!cur) return { ok: false, message: "Denomination not found" };
  if (!cur.value.equals(d.value) && (await usedCount(cur.id)) > 0) {
    const msg = "This denomination is part of a closed register count, so its value is frozen. Inactivate it and add a new one instead.";
    return { ok: false, message: msg, fieldErrors: { value: msg } };
  }
  try {
    await db.currencyDenomination.update({ where: { id: cur.id }, data: { value: d.value, label: d.label || null, active: d.active } });
  } catch (e) {
    if (isUnique(e)) return { ok: false, message: DUP, fieldErrors: { value: DUP } };
    throw e;
  }
  return done(d.active ? "Denomination saved" : "Denomination saved (inactive)");
}

export async function deleteDenomination(id: unknown): Promise<DenominationResult> {
  const denied = await authorize();
  if (denied) return denied;
  const did = denominationIdSchema.safeParse(id);
  if (!did.success) return { ok: false, message: "Denomination not found" };
  const cur = await db.currencyDenomination.findUnique({ where: { id: did.data }, select: { id: true } });
  if (!cur) return { ok: false, message: "Denomination not found" };
  if ((await usedCount(cur.id)) > 0) return { ok: false, message: "This denomination is part of a closed register count and cannot be deleted. Inactivate it instead." };
  await db.currencyDenomination.delete({ where: { id: cur.id } });
  return done("Denomination deleted");
}
