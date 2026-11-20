import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { getPersonalTheme } from "@/lib/preferences";
import { getGlobalTheme, getShellBranding } from "@/lib/settings";
import { DEFAULT_THEME } from "@/lib/theme";
import ThemeSettingsForm from "@/components/settings/ThemeSettingsForm";
import ClearCacheSection from "@/components/settings/ClearCacheSection";

export const metadata: Metadata = { title: "Appearance & Cache" };

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
  const organization = global ?? DEFAULT_THEME; // what "Reset to organization default" returns to

  return (
    <ThemeSettingsForm variant="personal" saved={personal ?? organization} defaults={organization} brandName={brand.name}>
      <ClearCacheSection />
    </ThemeSettingsForm>
  );
}
