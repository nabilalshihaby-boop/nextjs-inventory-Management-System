"use server";

import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { getDict } from "@/lib/i18n/server";
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
  const t = await getDict();
  if (!userId) return { ok: false, message: t.common.sessionExpired };

  const theme = parseTheme(input);
  if (!theme) return { ok: false, message: t.theme.invalidTheme };

  const exists = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!exists) return { ok: false, message: t.password.notFound };

  await db.userPreference.upsert({
    where: { userId },
    create: { userId, theme },
    update: { theme },
  });
  return { ok: true, message: t.theme.prefSaved, theme };
}

/** Delete only the current user's personal theme → the organization (Owner) theme applies again. */
export async function resetPreference(): Promise<ThemeActionResult> {
  const userId = await currentUserId();
  const t = await getDict();
  if (!userId) return { ok: false, message: t.common.sessionExpired };

  // Only the theme goes back to the organization default; a saved language stays (the row is removed only when empty).
  await db.userPreference.updateMany({ where: { userId }, data: { theme: Prisma.DbNull } });
  await db.userPreference.deleteMany({ where: { userId, theme: { equals: Prisma.DbNull }, locale: null } });
  return { ok: true, message: t.theme.prefRestored, theme: null };
}
