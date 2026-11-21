"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { clearPinSchema, setPinSchema } from "@/lib/pos-pin";
import { getDict } from "@/lib/i18n/server";
import { canUsePos } from "@/lib/roles";
import { clearFailures, isLimited, recordFailure } from "@/lib/unlock-limiter";

// Personal POS Cashier PIN (Profile page). Rules enforced here, on the server:
// - Only OWNER/ADMIN (the roles that can use the POS); the target is ALWAYS the signed-in user taken from
//   auth() - a payload cannot name another user (strict Zod rejects any extra key such as userId).
// - The CURRENT account password must be re-entered (bcrypt.compare) to set, change or clear the PIN.
// - PIN: 4-8 digits, not all-equal / ascending / descending, confirmed; stored only as a bcrypt hash.
// - Responses carry a status and message only - never the PIN or any hash.
// - Password changes and password resets (users/actions.ts, change-password/actions.ts) deliberately do NOT
//   touch posPinHash: the PIN stays until the user explicitly changes or clears it.
// - Wrong current-password attempts count against the same 5-per-minute limiter as POS unlock.

export type PinResult = { ok: true; message: string; hasPin: boolean } | { ok: false; message: string; fieldErrors?: Record<string, string> };

async function authorize(): Promise<{ uid: string } | { error: PinResult }> {
  const s = await auth();
  const t = await getDict();
  if (!s?.user?.id) return { error: { ok: false, message: t.common.sessionExpired } };
  if (!canUsePos(s.user.role)) return { error: { ok: false, message: t.pin.rolesOnly } };
  return { uid: s.user.id };
}
async function invalid(error: { issues: { path: PropertyKey[]; code: string; message: string }[] }): Promise<PinResult> {
  const t = await getDict();
  const pinText = t.pin as Record<string, string>;
  const fieldErrors: Record<string, string> = {};
  for (const i of error.issues) {
    const known = i.message.startsWith("pin.") ? pinText[i.message.slice(4)] : undefined;
    fieldErrors[String(i.path[0] ?? "form")] ??= i.code === "unrecognized_keys" ? t.common.unexpectedFields : (known ?? i.message);
  }
  return { ok: false, message: Object.values(fieldErrors)[0] ?? t.common.checkForm, fieldErrors };
}
/** Verifies the current account password of THIS user (rate-limited). */
async function passwordOk(uid: string, password: string): Promise<PinResult | null> {
  if (isLimited(uid)) return { ok: false, message: (await getDict()).pin.tooMany };
  const u = await db.user.findUnique({ where: { id: uid }, select: { passwordHash: true } });
  if (!u || !(await bcrypt.compare(password, u.passwordHash))) {
    recordFailure(uid);
    const t = await getDict();
    return { ok: false, message: t.password.wrongCurrent, fieldErrors: { currentPassword: t.password.wrongCurrent } };
  }
  clearFailures(uid);
  return null;
}

export async function setPosPin(input: unknown): Promise<PinResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const v = setPinSchema.safeParse(input);
  if (!v.success) return await invalid(v.error);
  const bad = await passwordOk(a.uid, v.data.currentPassword);
  if (bad) return bad;
  await db.user.update({ where: { id: a.uid }, data: { posPinHash: await bcrypt.hash(v.data.pin, 12) }, select: { id: true } });
  revalidatePath("/profile");
  revalidatePath("/pos");
  return { ok: true, message: (await getDict()).pin.saved, hasPin: true };
}

export async function clearPosPin(input: unknown): Promise<PinResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const v = clearPinSchema.safeParse(input);
  if (!v.success) return await invalid(v.error);
  const bad = await passwordOk(a.uid, v.data.currentPassword);
  if (bad) return bad;
  await db.user.update({ where: { id: a.uid }, data: { posPinHash: null }, select: { id: true } });
  revalidatePath("/profile");
  revalidatePath("/pos");
  return { ok: true, message: (await getDict()).pin.removed, hasPin: false };
}
