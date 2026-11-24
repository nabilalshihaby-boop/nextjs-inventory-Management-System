import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { canManageSystemSettings, canManageTranslations } from "@/lib/roles";

// Needs the session per request.
export const instant = false;

// OWNER / ADMIN gate for /settings and every nested settings route (e.g. /settings/theme).
// Pages render in parallel with their layout, so each settings page repeats this check
// before reading any data, and each settings Server Action re-checks it too.
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  // /settings/languages is governed by translations.manage; every other settings page re-checks canManageSystemSettings itself.
  if (!canManageSystemSettings(session.user) && !canManageTranslations(session.user)) redirect("/dashboard");
  return children;
}
