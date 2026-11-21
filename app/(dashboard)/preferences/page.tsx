import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { getPersonalTheme } from "@/lib/preferences";
import { getGlobalTheme, getShellBranding } from "@/lib/settings";
import { DEFAULT_THEME } from "@/lib/theme";
import ThemeSettingsForm from "@/components/settings/ThemeSettingsForm";
import ClearCacheSection from "@/components/settings/ClearCacheSection";
import LanguageSwitch from "@/components/i18n/LanguageSwitch";
import { getDict } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).theme.titlePersonal };
}

export const instant = false;

// Personal appearance preferences + Clear Cache. Every signed-in role (OWNER, ADMIN, USER) may use
// it, but only for their own account: the editor reads and writes the current user's preference only.
export default async function PreferencesPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const [personal, global, brand] = await Promise.all([
    getPersonalTheme(session.user.id),
    getGlobalTheme(),
    getShellBranding(),
  ]);
  const t = await getDict();
  const organization = global ?? DEFAULT_THEME; // what "Reset to organization default" returns to

  return (
    <ThemeSettingsForm variant="personal" saved={personal ?? organization} defaults={organization} brandName={brand.name}>
      <h2 className="t-section-title" style={{ margin: "32px 0 16px" }}>
        {t.prefs.languageTitle}
      </h2>
      <div className="sp-card" style={{ padding: 24, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <LanguageSwitch />
        <span className="t-caption">{t.prefs.languageHelp}</span>
      </div>
      <ClearCacheSection />
    </ThemeSettingsForm>
  );
}
