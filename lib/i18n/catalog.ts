// Server-owned translation catalog, derived from the code dictionaries. English (en.ts) is the read-only
// source of truth; ar.ts holds the DEFAULT Arabic. Database overrides (translation_overrides) only ever
// replace the Arabic text of a key that exists here. Nothing in this file comes from the client.
import { en } from "@/lib/i18n/dictionaries/en";
import { ar } from "@/lib/i18n/dictionaries/ar";

export const SECTIONS = [
  { id: "nav", label: "Dashboard & Navigation", groups: ["nav", "roles", "shell", "dash"] },
  { id: "auth", label: "Authentication & Account", groups: ["auth", "profile", "password", "pin"] },
  { id: "settings", label: "Settings & Preferences", groups: ["prefs", "theme", "settings", "denom", "currencies"] },
  { id: "users", label: "Users & Roles", groups: ["users"] },
  { id: "pos", label: "POS & Register", groups: ["pos", "register", "posTx", "posReceipt"] },
  { id: "shared", label: "Shared UI & Reports", groups: ["common", "report"] },
  // Prepared for later phases (no keys yet -> "No translations in this section yet").
  { id: "sales", label: "Sales", groups: ["sales", "salesReturns", "quotations"] },
  { id: "purchases", label: "Purchases", groups: ["purchases", "purchaseReturns"] },
  { id: "finance", label: "Finance", groups: ["finance", "expenses"] },
  { id: "products", label: "Products & Inventory", groups: ["products", "catalog", "warehouses", "transfers", "adjustments", "importExport", "stockGuard"] },
  { id: "people", label: "Customers & Suppliers", groups: ["custPay", "customers", "stmt", "suppliers", "supplierPay", "supplierStmt"] },
  { id: "reports", label: "Reports", groups: ["stmtReport", "supplierStmtReport", "registerReport", "invReports"] },
] as const;
export type SectionId = (typeof SECTIONS)[number]["id"];

// The management screen's own labels are deliberately NOT editable (an override could make the screen unusable).
const EXCLUDED_GROUPS = new Set(["langAdmin"]);

export type CatalogEntry = { key: string; section: SectionId; en: string; ar: string; placeholders: string[] };

/** Placeholder tokens as written: {name} or {{count}}; sorted and de-duplicated. */
export function placeholdersOf(s: string): string[] {
  const found = s.match(/\{\{\s*\w+\s*\}\}|\{\w+\}/g) ?? [];
  return [...new Set(found)].sort();
}
export const samePlaceholders = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

function flatten(o: unknown, prefix: string, out: Map<string, string>) {
  if (typeof o === "string") return void out.set(prefix, o);
  if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
}

function build(): CatalogEntry[] {
  const e = new Map<string, string>();
  const a = new Map<string, string>();
  flatten(en, "", e);
  flatten(ar, "", a);
  const sectionOf = new Map<string, SectionId>();
  for (const s of SECTIONS) for (const g of s.groups) sectionOf.set(g, s.id);
  const list: CatalogEntry[] = [];
  for (const [key, text] of e) {
    const group = key.split(".")[0];
    const section = sectionOf.get(group);
    if (!section || EXCLUDED_GROUPS.has(group)) continue;
    list.push({ key, section, en: text, ar: a.get(key) ?? text, placeholders: placeholdersOf(text) });
  }
  return list;
}

export const CATALOG: readonly CatalogEntry[] = build();
export const CATALOG_BY_KEY: ReadonlyMap<string, CatalogEntry> = new Map(CATALOG.map((c) => [c.key, c]));
