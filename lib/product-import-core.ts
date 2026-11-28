// The column contract of the three product import templates (pure: shared by the template download, the validator and the Import page).
// Column names are a technical contract and are not translated; the guidance shown next to them is (dict.importExport.columns).
import { compareKey } from "@/lib/family-core";

export const IMPORT_MODES = ["standalone", "model", "group"] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];
export const isImportMode = (v: unknown): v is ImportMode => typeof v === "string" && (IMPORT_MODES as readonly string[]).includes(v);

/** [header, guidance key, required]. */
export const COMMON_COLUMNS = [
  ["Product Name", "productName", true],
  ["SKU", "sku", true],
  ["Barcode", "barcode", false],
  ["Handle", "handle", false],
  ["HS Code", "hsCode", false],
  ["Category", "category", true],
  ["Brand", "brand", true],
  ["Base Unit", "baseUnit", true],
  ["Purchase Price", "purchasePrice", true],
  ["Sale Price", "salePrice", true],
  ["Tax Type", "taxType", false],
  ["Tax Rate", "taxRate", false],
  ["Opening Quantity", "openingQuantity", false],
  ["Warehouse", "warehouse", false],
  ["Description", "description", false],
  ["Stock Alert", "stockAlert", false],
] as const;
export type CommonHeader = (typeof COMMON_COLUMNS)[number][0];
export type GuideKey = (typeof COMMON_COLUMNS)[number][1] | "model" | "color" | "size" | "dimension" | "groupHsCode";

export const MODEL_HEADERS = ["Model", "Color", "Size"] as const;
/** Model mode only, just before "HS Code": the group's default. "HS Code" on a row is then that product's own override. */
export const GROUP_HS_HEADER = "Group HS Code";
/** The single option of a group created by the Model + Color + Size import (stored as the family's dimension name). */
export const SIZE_DIMENSION = "Size";
/** Joins Model and Color into the group's name. */
export const groupNameOf = (model: string, color: string) => `${model} - ${color}`;

export type ImportColumn = { header: string; guide: GuideKey; required: boolean; dimension?: string };

const RESERVED = new Set<string>([...COMMON_COLUMNS.map((c) => c[0]), GROUP_HS_HEADER].map(compareKey));
/** The column of a group's dimension: its own name, or "name (option)" when that name is already a common column (e.g. "Brand"). */
export const dimensionHeader = (dimension: string) => (RESERVED.has(compareKey(dimension)) ? `${dimension} (option)` : dimension);

/**
 * The exact, ordered columns of a template. `dimensions` is required for "group" (the selected group's own, read on the server).
 * An existing group already has its handle, so its template has no Handle column (a value there could only be thrown away).
 */
export function importColumns(mode: ImportMode, dimensions: readonly string[] = []): ImportColumn[] {
  const common: ImportColumn[] = COMMON_COLUMNS.map(([header, guide, required]) => ({ header, guide, required }));
  if (mode === "standalone") return common;
  if (mode === "model") {
    const withGroupHs = common.flatMap((c): ImportColumn[] => (c.header === "HS Code" ? [{ header: GROUP_HS_HEADER, guide: "groupHsCode", required: false }, c] : [c]));
    return [...MODEL_HEADERS.map((header) => ({ header, guide: header.toLowerCase() as GuideKey, required: true })), ...withGroupHs];
  }
  return [...dimensions.map((d) => ({ header: dimensionHeader(d), guide: "dimension" as const, required: true, dimension: d })), ...common.filter((c) => c.header !== "Handle")];
}

// ---------------------------------------------------------------------------------------------
// The earlier one-size file (standalone products only). It is recognised ONLY when its columns are exactly these, in this order; nothing
// else is guessed or renamed.
// ---------------------------------------------------------------------------------------------

/** [legacy header, the column it means]. The SKU column was also called "Code" and "Product Code". */
export const LEGACY_COLUMNS: readonly (readonly [string, string])[] = [
  ["SKU", "SKU"],
  ["Product Name", "Product Name"],
  ["Category", "Category"],
  ["Brand", "Brand"],
  ["Unit", "Base Unit"],
  ["Warehouse", "Warehouse"],
  ["Opening Stock", "Opening Quantity"],
  ["Cost", "Purchase Price"],
  ["Selling Price", "Sale Price"],
  ["Stock Alert", "Stock Alert"],
  ["Tax Rate", "Tax Rate"],
  ["Tax Type", "Tax Type"],
];
export const LEGACY_SKU_ALIASES: readonly string[] = ["Code", "Product Code"];
/** Names only the old file used: two or more of them mean "this was meant to be an old file", so problems are reported in its terms. */
const LEGACY_ONLY = ["Unit", "Opening Stock", "Cost", "Selling Price"];
export const looksLegacy = (header: readonly string[]) => LEGACY_ONLY.filter((h) => header.includes(h)).length >= 2;
const canonicalLegacy = (h: string) => (LEGACY_SKU_ALIASES.includes(h) ? "SKU" : h);
export const isLegacyHeader = (header: readonly string[]) => header.length === LEGACY_COLUMNS.length && header.every((h, i) => canonicalLegacy(h) === LEGACY_COLUMNS[i][0]);

export type HsSource = "own" | "group" | "none";
export type LegacyField = { from: string; to: string };

export type PreviewRow = { row: number; sku: string; name: string; status: "new" | "unchanged"; handle: string | null; generated: boolean; variant: string | null; group: string | null; quantity: string | null; hsCode: string | null; hsSource: HsSource };
export type PreviewGroup = { name: string; handle: string; generated: boolean; existing: boolean; hsCode: string | null; dimensions: string[]; variants: { row: number; sku: string; variant: string }[] };
