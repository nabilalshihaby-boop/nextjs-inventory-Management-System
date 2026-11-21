"use server";

import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { unlockSchema } from "@/lib/pos-held";
import { unlockPinSchema } from "@/lib/pos-pin";
import { canUsePos } from "@/lib/roles";
import { getDict } from "@/lib/i18n/server";
import { clearFailures, isLimited, recordFailure } from "@/lib/unlock-limiter";

// POS Lock Screen unlock. This is an INTERFACE lock only: it does not touch the Auth.js session,
// other tabs or other routes, and it writes nothing. Two ways to unlock, both checked on the server
// against the CURRENT signed-in user only (the user id comes from auth(), never from the client):
//  - the account password (bcrypt hash in users.passwordHash), and
//  - the optional Cashier PIN (bcrypt hash in users.posPinHash, set on the Profile page).
// Neither secret is stored, logged or echoed; every failure says the same generic thing. At most 5
// failed attempts per user per minute ACROSS BOTH methods (lib/unlock-limiter.ts), without saying which
// credential was wrong. A PIN is not a login: it never creates a session or grants any other access.

export type UnlockResult = { ok: true } | { ok: false; message: string };

async function who(): Promise<{ uid: string } | { error: UnlockResult }> {
  const s = await auth();
  const t = await getDict();
  if (!s?.user?.id) return { error: { ok: false, message: t.common.sessionExpired } };
  if (!canUsePos(s.user.role)) return { error: { ok: false, message: t.pos.noPermission } };
  return { uid: s.user.id };
}

export async function unlockPos(input: unknown): Promise<UnlockResult> {
  const w = await who();
  if ("error" in w) return w.error;
  const v = unlockSchema.safeParse(input);
  const t = await getDict();
  if (!v.success) return { ok: false, message: t.pos.incorrectPassword };
  if (isLimited(w.uid)) return { ok: false, message: t.pin.tooMany };

  const user = await db.user.findUnique({ where: { id: w.uid }, select: { passwordHash: true } });
  const ok = !!user && (await bcrypt.compare(v.data.password, user.passwordHash));
  if (!ok) {
    recordFailure(w.uid);
    return { ok: false, message: t.pos.incorrectPassword };
  }
  clearFailures(w.uid);
  return { ok: true };
}

export async function unlockPosWithPin(input: unknown): Promise<UnlockResult> {
  const w = await who();
  if ("error" in w) return w.error;
  const v = unlockPinSchema.safeParse(input);
  const t = await getDict();
  if (!v.success) return { ok: false, message: t.pin.incorrect };
  if (isLimited(w.uid)) return { ok: false, message: t.pin.tooMany };

  const user = await db.user.findUnique({ where: { id: w.uid }, select: { posPinHash: true } });
  // No PIN configured (or a wrong one) look the same and both count as a failed attempt.
  const ok = !!user?.posPinHash && (await bcrypt.compare(v.data.pin, user.posPinHash));
  if (!ok) {
    recordFailure(w.uid);
    return { ok: false, message: t.pin.incorrect };
  }
  clearFailures(w.uid);
  return { ok: true };
}
