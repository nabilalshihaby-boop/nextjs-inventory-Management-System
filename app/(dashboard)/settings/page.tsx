import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { getCountryOptions } from "@/lib/countries";
import { canManageSystemSettings } from "@/lib/roles";
import { DATE_FORMATS, getCurrencyOptions, getSystemSettings, toSettingsValues } from "@/lib/settings";
import SettingsForm from "@/components/settings/SettingsForm";

export const metadata: Metadata = { title: "Settings" };

// Needs the session + database per request, so navigations here may block.
export const instant = false;

// System Settings (design/Settings.html). Global settings: OWNER only.
export default async function SettingsPage() {
  await connection();
  // Checked again here (not only in settings/layout.tsx): the page renders in parallel with
  // the layout, so the role must be verified before any settings data is read.
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageSystemSettings(session.user.role)) redirect("/dashboard");

  const [settings, currencies] = await Promise.all([getSystemSettings(), getCurrencyOptions()]);

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          System Settings
        </h1>
        <div style={{ display: "flex", gap: 12 }} />
      </div>
      <SettingsForm
        initial={toSettingsValues(settings)}
        countries={getCountryOptions()}
        currencies={currencies}
        dateFormats={[...DATE_FORMATS]}
      />
    </>
  );
}
