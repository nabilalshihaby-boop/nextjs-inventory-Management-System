"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { getDict } from "@/lib/i18n/server";
import { canManageSystemSettings } from "@/lib/roles";
import { SETTINGS_ID } from "@/lib/settings";
import { isDefaultTheme, parseTheme, type ThemeState } from "@/lib/theme";

export type ThemeActionResult =
  | { ok: true; message: string; theme: ThemeState | null }
  | { ok: false; message: string };

async function ownerCheck(): Promise<ThemeActionResult | null> {
  // OWNER only — re-checked in every action (page gating is not a security boundary).
  const session = await auth();
  const t = await getDict();
  if (!session?.user?.id) return { ok: false, message: t.common.sessionExpired };
  if (!canManageSystemSettings(session.user.role)) return { ok: false, message: t.theme.onlyOwner };
  return null;
}

/** Save the global theme. Only SystemSettings.theme is written; nothing else changes. */
export async function saveTheme(input: unknown): Promise<ThemeActionResult> {
  const denied = await ownerCheck();
  if (denied) return denied;

  const theme = parseTheme(input);
  if (!theme) return { ok: false, message: (await getDict()).theme.invalidTheme };

  // A theme identical to the Bluepiller defaults is stored as "no override" (SQL NULL).
  const stored = isDefaultTheme(theme) ? null : theme;
  const { count } = await db.systemSettings.updateMany({
    where: { id: SETTINGS_ID },
    data: { theme: stored ?? Prisma.DbNull },
  });
  if (count === 0) return { ok: false, message: (await getDict()).theme.saveSettingsFirst };

  revalidatePath("/", "layout"); // every dashboard page renders the global theme
  return { ok: true, message: (await getDict()).theme.saved, theme: stored };
}

/** Remove the saved global theme override only; all other settings are untouched. */
export async function resetTheme(): Promise<ThemeActionResult> {
  const denied = await ownerCheck();
  if (denied) return denied;

  await db.systemSettings.updateMany({ where: { id: SETTINGS_ID }, data: { theme: Prisma.DbNull } });
  revalidatePath("/", "layout");
  return { ok: true, message: (await getDict()).theme.restored, theme: null };
}
