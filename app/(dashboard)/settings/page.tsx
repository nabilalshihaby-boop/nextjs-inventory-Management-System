import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getCountryOptions } from "@/lib/countries";
import { getLocale, getDict } from "@/lib/i18n/server";
import { canManageSystemSettings } from "@/lib/roles";
import { DATE_FORMATS, getCurrencyOptions, getSystemSettings, toSettingsValues } from "@/lib/settings";
import SettingsForm from "@/components/settings/SettingsForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).settings.title };
}

// Needs the session + database per request, so navigations here may block.
export const instant = false;

// System Settings (design/Settings.html). Global settings: OWNER only.
export default async function SettingsPage() {
  await connection();
  // Checked again here (not only in settings/layout.tsx): the page renders in parallel with
  // the layout, so the role must be verified before any settings data is read.
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageSystemSettings(session.user)) redirect("/dashboard");

  const locale = await getLocale();
  const t = await getDict();
  const regionNames = new Intl.DisplayNames([locale], { type: "region" });
  const [settings, currencies, customers] = await Promise.all([getSystemSettings(), getCurrencyOptions(), db.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })]);

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {t.settings.title}
        </h1>
        <div style={{ display: "flex", gap: 12 }} />
      </div>
      <SettingsForm
        initial={toSettingsValues(settings)}
        // Country names are shown in the UI language; the stored value stays the ISO code.
        countries={getCountryOptions().map((c) => ({ ...c, name: regionNames.of(c.code) ?? c.name }))}
        currencies={currencies}
        customers={customers.map((c) => ({ value: c.id, label: c.name }))}
        dateFormats={[...DATE_FORMATS]}
      />
    </>
  );
}
