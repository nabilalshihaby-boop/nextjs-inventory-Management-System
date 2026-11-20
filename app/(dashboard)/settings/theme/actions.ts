"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { canManageSystemSettings } from "@/lib/roles";
import { SETTINGS_ID } from "@/lib/settings";
import { isDefaultTheme, parseTheme, type ThemeState } from "@/lib/theme";

export type ThemeActionResult =
  | { ok: true; message: string; theme: ThemeState | null }
  | { ok: false; message: string };

async function ownerCheck(): Promise<ThemeActionResult | null> {
  // OWNER only — re-checked in every action (page gating is not a security boundary).
  const session = await auth();
  if (!session?.user?.id) return { ok: false, message: "Your session has expired. Please sign in again." };
  if (!canManageSystemSettings(session.user.role)) return { ok: false, message: "Only the owner can change the theme." };
  return null;
}

/** Save the global theme. Only SystemSettings.theme is written; nothing else changes. */
export async function saveTheme(input: unknown): Promise<ThemeActionResult> {
  const denied = await ownerCheck();
  if (denied) return denied;

  const theme = parseTheme(input);
  if (!theme) return { ok: false, message: "Fix invalid theme values before saving." };

  // A theme identical to the Bluepiller defaults is stored as "no override" (SQL NULL).
  const stored = isDefaultTheme(theme) ? null : theme;
  const { count } = await db.systemSettings.updateMany({
    where: { id: SETTINGS_ID },
    data: { theme: stored ?? Prisma.DbNull },
  });
  if (count === 0) return { ok: false, message: "Save System Settings first, then customize the theme." };

  revalidatePath("/", "layout"); // every dashboard page renders the global theme
  return { ok: true, message: "Theme settings saved successfully.", theme: stored };
}

/** Remove the saved global theme override only; all other settings are untouched. */
export async function resetTheme(): Promise<ThemeActionResult> {
  const denied = await ownerCheck();
  if (denied) return denied;

  await db.systemSettings.updateMany({ where: { id: SETTINGS_ID }, data: { theme: Prisma.DbNull } });
  revalidatePath("/", "layout");
  return { ok: true, message: "Original theme restored successfully.", theme: null };
}
