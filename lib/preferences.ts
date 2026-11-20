import { cache } from "react";
import { db } from "@/lib/db";
import { getGlobalTheme } from "@/lib/settings";
import { parseTheme, type ThemeState } from "@/lib/theme";

/** A user's saved personal theme, or null. Invalid/unsafe stored data is ignored. Deduplicated per request. */
export const getPersonalTheme = cache(async (userId: string): Promise<ThemeState | null> => {
  const pref = await db.userPreference.findUnique({ where: { userId }, select: { theme: true } });
  return parseTheme(pref?.theme ?? null);
});

/**
 * The theme a user sees, in precedence order:
 * 1. their saved personal preference, 2. the Owner's global theme, 3. Bluepiller defaults (null).
 */
export async function getEffectiveTheme(userId: string): Promise<{ theme: ThemeState | null; source: "personal" | "global" | "default" }> {
  const [personal, global] = await Promise.all([getPersonalTheme(userId), getGlobalTheme()]);
  if (personal) return { theme: personal, source: "personal" };
  if (global) return { theme: global, source: "global" };
  return { theme: null, source: "default" };
}
