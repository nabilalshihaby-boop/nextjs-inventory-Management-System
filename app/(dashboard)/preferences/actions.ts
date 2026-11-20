"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { parseTheme } from "@/lib/theme";
import type { ThemeActionResult } from "@/app/(dashboard)/settings/theme/actions";

// Personal appearance preferences: any signed-in role (OWNER, ADMIN, USER) manages ONLY their own.
// The user id always comes from auth() — never from the client — and only user_preferences is written.

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/** Save the current user's personal theme (validated; malformed or unsafe values are rejected). */
export async function savePreference(input: unknown): Promise<ThemeActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, message: "Your session has expired. Please sign in again." };

  const theme = parseTheme(input);
  if (!theme) return { ok: false, message: "Fix invalid theme values before saving." };

  const exists = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!exists) return { ok: false, message: "Your account could not be found." };

  await db.userPreference.upsert({
    where: { userId },
    create: { userId, theme },
    update: { theme },
  });
  return { ok: true, message: "Your appearance preferences were saved.", theme };
}

/** Delete only the current user's personal theme → the organization (Owner) theme applies again. */
export async function resetPreference(): Promise<ThemeActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, message: "Your session has expired. Please sign in again." };

  await db.userPreference.deleteMany({ where: { userId } });
  return { ok: true, message: "Organization default theme restored.", theme: null };
}
