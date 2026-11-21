"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { LOCALES, LOCALE_COOKIE } from "@/lib/i18n/config";

// Language preference. Only the locale value is accepted (validated against the two built-in locales);
// the user is ALWAYS the signed-in session user from auth() - there is no user id in the payload, and strict
// Zod rejects any extra key, so one user can never change another user's language. Signed-out visitors
// (Sign In page) only get the cookie. Business data, sessions and roles are never touched.

export type LanguageResult = { ok: true; locale: "en" | "ar" } | { ok: false; message: string };
const schema = z.object({ locale: z.enum(LOCALES) }).strict();

export async function setLanguage(input: unknown): Promise<LanguageResult> {
  const v = schema.safeParse(input);
  if (!v.success) return { ok: false, message: "Unsupported language" };
  const { locale } = v.data;

  const session = await auth();
  if (session?.user?.id) {
    // Extends the existing user_preferences row (one row per user; the theme column is left as it is).
    await db.userPreference.upsert({ where: { userId: session.user.id }, create: { userId: session.user.id, locale }, update: { locale } });
  }
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  return { ok: true, locale };
}
