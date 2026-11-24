import { cache } from "react";
import { db } from "@/lib/db";
import { siteConfig } from "@/config/site";
import pkg from "@/package.json";
import { parseTheme, type ThemeState } from "@/lib/theme";

// Default currency options come from real Currency records (see getCurrencyOptions).
export const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const;

export const SETTINGS_ID = 1; // singleton row

/** Settings as plain form values (strings, "" for empty). */
export type SettingsValues = {
  /** Currency record id ("" when none is selected yet). */
  defaultCurrencyId: string;
  /** POS Walk-in Customer id ("" = none). */
  posWalkInCustomerId: string;
  /** Default Warehouse id ("" = none). */
  defaultWarehouseId: string;
  defaultEmail: string;
  currencyIconRight: boolean;
  companyLogo: string | null;
  companyName: string;
  companyPhone: string;
  developedBy: string;
  footerText: string;
  country: string;
  state: string;
  city: string;
  postalCode: string;
  dateFormat: string;
  address: string;
  showVersionInFooter: boolean;
};

/** Empty form for when settings were never saved — no invented company data or defaults. */
export const EMPTY_SETTINGS: SettingsValues = {
  defaultCurrencyId: "",
  posWalkInCustomerId: "",
  defaultWarehouseId: "",
  defaultEmail: "",
  currencyIconRight: false,
  companyLogo: null,
  companyName: "",
  companyPhone: "",
  developedBy: "",
  footerText: "",
  country: "",
  state: "",
  city: "",
  postalCode: "",
  dateFormat: "",
  address: "",
  showVersionInFooter: false,
};

type SettingsRow = NonNullable<Awaited<ReturnType<typeof db.systemSettings.findUnique>>>;

export function toSettingsValues(s: SettingsRow | null): SettingsValues {
  if (!s) return EMPTY_SETTINGS;
  return {
    defaultCurrencyId: s.defaultCurrencyId ?? "",
    posWalkInCustomerId: s.posWalkInCustomerId ?? "",
    defaultWarehouseId: s.defaultWarehouseId ?? "",
    defaultEmail: s.defaultEmail ?? "",
    currencyIconRight: s.currencyIconRight,
    companyLogo: s.companyLogo,
    companyName: s.companyName,
    companyPhone: s.companyPhone ?? "",
    developedBy: s.developedBy ?? "",
    footerText: s.footerText ?? "",
    country: s.country,
    state: s.state,
    city: s.city ?? "",
    postalCode: s.postalCode ?? "",
    dateFormat: s.dateFormat,
    address: s.address ?? "",
    showVersionInFooter: s.showVersionInFooter,
  };
}

/** Default-currency select options from real Currency records (value = Currency id). */
export async function getCurrencyOptions() {
  const rows = await db.currency.findMany({ orderBy: [{ name: "asc" }, { code: "asc" }], select: { id: true, name: true, code: true, symbol: true } });
  return rows.map((c) => ({ value: c.id, label: `${c.name} (${c.code}, ${c.symbol})` }));
}

/** The singleton settings row, or null if it has never been saved. Deduplicated per request. */
export const getSystemSettings = cache(async () => db.systemSettings.findUnique({ where: { id: SETTINGS_ID } }));

export type ShellBranding = { name: string; logo: string | null; footerText: string; /** The footer text the Owner typed (empty = use the localized default). */ footerCustom: string; version: string | null };

/** Global branding from a settings row (or none), with Bluepiller fallbacks for missing values. */
export function brandingFrom(
  s: Pick<SettingsRow, "companyName" | "companyLogo" | "footerText" | "showVersionInFooter"> | null,
): ShellBranding {
  const name = s?.companyName?.trim() || siteConfig.name;
  return {
    name,
    logo: s?.companyLogo || null,
    footerText: s?.footerText?.trim() || `All Rights Reserved © 2026 ${name}`,
    footerCustom: s?.footerText?.trim() || "",
    version: s?.showVersionInFooter ? pkg.version : null,
  };
}

/** The System Settings default currency (symbol + position), or null if none is configured. */
export async function getDefaultCurrency(): Promise<{ id: string; code: string; symbol: string; right: boolean } | null> {
  const s = await getSystemSettings();
  if (!s?.defaultCurrencyId) return null;
  const c = await db.currency.findUnique({ where: { id: s.defaultCurrencyId }, select: { id: true, code: true, symbol: true } });
  return c ? { ...c, right: s.currencyIconRight } : null;
}

/** The Owner's saved global theme, or null (→ Bluepiller defaults). Invalid stored data is ignored. */
export async function getGlobalTheme(): Promise<ThemeState | null> {
  return parseTheme((await getSystemSettings())?.theme ?? null);
}

/** Global branding (company name, logo, footer, version) for the dashboard shell and Sign In page. */
export async function getShellBranding(): Promise<ShellBranding> {
  return brandingFrom(await getSystemSettings());
}
