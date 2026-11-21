// Server-only locale resolution. Order: the signed-in user's saved language -> the bp-locale cookie -> English.
// No locale-prefixed routes are used and proxy.ts is untouched. Everything here is request-scoped.
import { cache } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { DEFAULT_LOCALE, LOCALE_COOKIE, dirOf, intlTag, isLocale, type Locale } from "@/lib/i18n/config";
import { dictionaries, type Dictionary } from "@/lib/i18n";
import { applyOverrides, getArabicOverrides } from "@/lib/i18n/overrides";

const getViewer = cache(async (): Promise<{ locale: Locale; signedIn: boolean }> => {
  await connection(); // cookies/session need the real request (auth() uses crypto before reading cookies)
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  let locale: Locale = isLocale(fromCookie) ? fromCookie : DEFAULT_LOCALE;
  let signedIn = false;
  try {
    const session = await auth();
    if (session?.user?.id) {
      signedIn = true;
      const pref = await db.userPreference.findUnique({ where: { userId: session.user.id }, select: { locale: true } });
      if (isLocale(pref?.locale)) locale = pref.locale;
    }
  } catch {
    // Sign-in must keep working even if the preference cannot be read: fall back to the cookie.
  }
  return { locale, signedIn };
});

export const getLocale = cache(async (): Promise<Locale> => (await getViewer()).locale);

// The effective dictionary. Arabic overrides (OWNER-managed, database) apply ONLY to signed-in requests:
// signed-out pages (Sign In) always use the base dictionaries, so nothing editable is served publicly.
const getEffectiveDict = cache(async (): Promise<Dictionary> => {
  const { locale, signedIn } = await getViewer();
  if (locale === "ar" && signedIn) return applyOverrides(dictionaries.ar, await getArabicOverrides());
  return dictionaries[locale];
});

/** The dictionary for the current request (Server Components and Server Actions). */
export async function getDict(): Promise<Dictionary> {
  return getEffectiveDict();
}
export async function getLocaleInfo() {
  const locale = await getLocale();
  return { locale, dir: dirOf(locale), tag: intlTag(locale), dict: await getEffectiveDict() };
}
