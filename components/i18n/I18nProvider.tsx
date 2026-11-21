"use client";

import { createContext, useContext, type ReactNode } from "react";
import { fmt, type Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";

// Client-side access to the current language. The server picks the locale per request and passes ONLY that
// locale's dictionary down, so client components read typed text with useT() and never branch on the language.
type Ctx = { locale: Locale; dir: "ltr" | "rtl"; tag: string; t: Dictionary };
const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ value, children }: { value: Ctx; children: ReactNode }) {
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
function useCtx() {
  const c = useContext(I18nContext);
  if (!c) throw new Error("useT must be used inside <I18nProvider>");
  return c;
}
export const useT = () => useCtx().t;
export const useLocale = () => {
  const { locale, dir, tag } = useCtx();
  return { locale, dir, tag };
};
export { fmt };
