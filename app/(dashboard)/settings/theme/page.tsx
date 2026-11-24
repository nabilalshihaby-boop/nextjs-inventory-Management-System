import { getDict } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { canManageSystemSettings } from "@/lib/roles";
import { getGlobalTheme, getShellBranding, getSystemSettings } from "@/lib/settings";
import { DEFAULT_THEME } from "@/lib/theme";
import ThemeSettingsForm from "@/components/settings/ThemeSettingsForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).theme.title };
}

export const instant = false;

// Global Owner Theme Settings (design/Theme Settings.html). OWNER only — also enforced by
// settings/layout.tsx and inside every theme Server Action.
export default async function ThemeSettingsPage() {
  await connection();
  // Checked before any data is read (the page renders in parallel with the settings layout).
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageSystemSettings(session.user)) redirect("/dashboard");

  const [saved, brand, settings] = await Promise.all([getGlobalTheme(), getShellBranding(), getSystemSettings()]);

  return (
    <ThemeSettingsForm
      saved={saved ?? DEFAULT_THEME}
      defaults={DEFAULT_THEME}
      brandName={brand.name}
      hasSettingsRecord={!!settings}
    />
  );
}
