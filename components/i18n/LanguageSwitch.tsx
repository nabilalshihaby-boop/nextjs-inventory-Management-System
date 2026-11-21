"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { setLanguage } from "@/app/language-actions";
import { useLocale, useT } from "@/components/i18n/I18nProvider";
import { LOCALES, type Locale } from "@/lib/i18n/config";

// English / Arabic selector. Signed-in: saved to the user's own preference (server derives the user from the
// session); signed-out: cookie only. The UI refreshes immediately with the new language and direction.
export default function LanguageSwitch({ className = "" }: { className?: string }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const label = (l: Locale) => (l === "ar" ? t.shell.languageAr : t.shell.languageEn);

  function choose(l: Locale) {
    if (l === locale || pending) return;
    startTransition(async () => {
      try {
        const r = await setLanguage({ locale: l });
        if (!r.ok) return void toast.error(t.prefs.languageFailed, { id: "lang" });
        router.refresh();
      } catch {
        toast.error(t.prefs.languageFailed, { id: "lang" });
      }
    });
  }

  return (
    <div className={`bp-lang ${className}`.trim()} role="group" aria-label={t.shell.languageLabel} data-testid="lang-switch">
      {LOCALES.map((l) => (
        <button key={l} type="button" lang={l} data-locale={l} aria-pressed={l === locale} disabled={pending} onClick={() => choose(l)}>
          {label(l)}
        </button>
      ))}
    </div>
  );
}
