// Server-only: the company identity printed on every report, from System Settings (real values
// only — anything not stored is simply left out).
import { getCountryOptions } from "@/lib/countries";
import { formatDateTime } from "@/lib/format";
import { getLocale } from "@/lib/i18n/server";
import { getShellBranding, getSystemSettings } from "@/lib/settings";

export type ReportCompany = { name: string; logo: string | null; lines: string[] };

export async function getReportCompany(): Promise<{ company: ReportCompany; generatedAt: string; dateFormat: string | null }> {
  const [s, brand, locale] = await Promise.all([getSystemSettings(), getShellBranding(), getLocale()]);
  const country = new Map<string, string>(getCountryOptions(locale).map((c) => [c.code, c.name]));
  const address = [s?.address, s?.city, s?.state, s?.country ? (country.get(s.country) ?? s.country) : ""].filter(Boolean).join(", ");
  const contact = [s?.companyPhone, s?.defaultEmail].filter(Boolean).join(" · ");
  return {
    company: { name: brand.name, logo: brand.logo, lines: [address, contact].filter(Boolean) },
    generatedAt: formatDateTime(new Date(), s?.dateFormat, locale),
    dateFormat: s?.dateFormat ?? null,
  };
}
