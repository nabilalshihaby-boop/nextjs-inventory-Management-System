"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { auth, updateSession } from "@/auth";
import { db } from "@/lib/db";
import { getDict } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n";
import { createSessionGrant } from "@/lib/session-upgrade";

export type PasswordField = "currentPassword" | "newPassword" | "confirmPassword";

// Never contains a password: only status, a message and per-field messages.
export type ChangePasswordState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors: Partial<Record<PasswordField, string>> }
  | { status: "success"; message: string };

// Messages come from the user's language dictionary (the schema is built per request).
const schema = (t: Dictionary) =>
  z
    .object({
      currentPassword: z.string().min(1, t.password.currentRequired),
      newPassword: z
        .string()
        .min(8, t.password.newMin)
        // bcrypt only uses the first 72 bytes; refuse longer input instead of silently truncating it.
        .refine((v) => new TextEncoder().encode(v).length <= 72, t.password.newMax),
      confirmPassword: z.string().min(1, t.password.confirmRequired),
    })
    .refine((v) => v.newPassword === v.confirmPassword, {
      path: ["confirmPassword"],
      message: t.password.mismatch,
    });

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

export async function changePassword(_prev: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  // Identity comes only from the session — any id sent by the client is never read.
  const session = await auth();
  const userId = session?.user?.id;
  const t = await getDict();
  if (!userId) return { status: "error", message: t.common.sessionExpired, fieldErrors: {} };

  const parsed = schema(t).safeParse({
    currentPassword: str(formData.get("currentPassword")),
    newPassword: str(formData.get("newPassword")),
    confirmPassword: str(formData.get("confirmPassword")),
  });
  if (!parsed.success) {
    const fieldErrors: Partial<Record<PasswordField, string>> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as PasswordField] ??= issue.message;
    const first = parsed.error.issues[0]?.message ?? "Please check the form";
    return { status: "error", message: first, fieldErrors };
  }
  const { currentPassword, newPassword } = parsed.data;

  // The hash is read here on the server only and never leaves this function.
  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user) return { status: "error", message: t.password.notFound, fieldErrors: {} };

  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return {
      status: "error",
      message: t.password.wrongCurrent,
      fieldErrors: { currentPassword: t.password.wrongCurrent },
    };
  }
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    return {
      status: "error",
      message: t.password.sameAsOld,
      fieldErrors: { newPassword: t.password.sameAsOld },
    };
  }

  // passwordHash and sessionVersion change together (one UPDATE statement = one transaction):
  // bumping the version ends every existing session of this user on its next request.
  const updated = await db.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(newPassword, 12), sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });

  // Keep THIS session signed in: re-issue its cookie with the new version via a one-time,
  // server-memory grant (never sent to the browser; see lib/session-upgrade.ts and auth.ts).
  // All other old sessions (other browsers/devices) are invalidated.
  // (The grant isn't part of the Session type; auth.ts reads it from the update payload.)
  await updateSession({ grant: createSessionGrant(userId, updated.sessionVersion) } as unknown as Parameters<typeof updateSession>[0]);
  return { status: "success", message: t.password.updated };
}
