// Localization config shared by server and client. Exactly two built-in locales in Phase 1.
export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
/** Cookie fallback for signed-out pages (Sign In) and the mirror of the signed-in choice. */
export const LOCALE_COOKIE = "bp-locale";
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", ar: "العربية" };

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);
export const dirOf = (l: Locale): "ltr" | "rtl" => (l === "ar" ? "rtl" : "ltr");
/** Intl tag used for number/date display only (stored values never change). Latin digits keep money/refs readable. */
export const intlTag = (l: Locale) => (l === "ar" ? "ar-EG-u-nu-latn" : "en-US");

/** Replace {name} placeholders. */
export function fmt(s: string, vars: Record<string, string | number> = {}): string {
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
