import { warehouseFilter } from "@/lib/access-scope";
import { parse } from "csv-parse/sync";
import type { Prisma } from "@/app/generated/prisma/client";
import { fmt } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";
import { makeProductSchemas, normalizeCode, type ProductFields } from "@/lib/products";
import { identifierKey } from "@/lib/product-identifiers";

// CSV product import — parsing and validation (server-only). Import is CREATE ONLY. The same module
// validates for the preview and again inside the confirming transaction, and the rows it returns are
// written through createProductRecord (lib/product-create.ts), exactly like the Create Product form.

/** The fixed, ordered column contract of the template. These names are technical and not translated. */
export const IMPORT_HEADERS = [
  "SKU",
  "Product Name",
  "Category",
  "Brand",
  "Unit",
  "Warehouse",
  "Opening Stock",
  "Cost",
  "Selling Price",
  "Stock Alert",
  "Tax Rate",
  "Tax Type",
] as const;
type Header = (typeof IMPORT_HEADERS)[number];
/** Headers an older template used for the SKU column. They are accepted as aliases of "SKU" when importing (the template itself says SKU).
 *  The internal CSV has no barcode column: barcodes are optional and managed on the product. */
export const LEGACY_SKU_HEADERS: readonly string[] = ["Product Code", "Code"];
const canonicalHeader = (h: string) => (LEGACY_SKU_HEADERS.includes(h) ? "SKU" : h);

export const MAX_IMPORT_MB = 5;
export const MAX_IMPORT_BYTES = MAX_IMPORT_MB * 1024 * 1024;
export const MAX_IMPORT_ROWS = 1000;
/** Barcode symbology isn't a CSV column; imported products use the form's first option. */
export const IMPORT_BARCODE = "CODE128" as const;

export type ImportIssue = { row: number; column: string; message: string };
export type ImportRow = { row: number; fields: ProductFields; stock: { warehouseId: string; quantity: string } | null };
export type ImportValidation = {
  total: number;
  /** Distinct rows that have at least one problem. */
  invalidRows: number;
  withStock: number;
  issues: ImportIssue[];
  rows: ImportRow[];
  /** True when the header row itself is wrong (no row was checked). */
  headerInvalid: boolean;
};

type FileResult = { ok: true; text: string } | { ok: false; message: string };

/** Content checks on the uploaded file (extension, size, UTF-8 text). Never trusts the client's MIME type. */
export async function readImportFile(file: unknown, t: Dictionary): Promise<FileResult> {
  const E = t.importExport.err;
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: E.noFile };
  if (!/\.csv$/i.test(file.name)) return { ok: false, message: E.notCsv };
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, message: fmt(E.tooLarge, { max: MAX_IMPORT_MB }) };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_IMPORT_BYTES) return { ok: false, message: fmt(E.tooLarge, { max: MAX_IMPORT_MB }) };
  if (bytes.includes(0)) return { ok: false, message: E.notText };
  try {
    // fatal: invalid UTF-8 is rejected instead of silently replaced; the BOM is removed here.
    let text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return { ok: true, text };
  } catch {
    return { ok: false, message: E.notText };
  }
}

type Records = { ok: true; header: string[]; data: { row: number; cells: string[] }[] } | { ok: false; message: string };

/** RFC 4180 parsing (quoted commas/quotes/newlines, CRLF or LF) with a real parser — never split(","). */
export function parseImportCsv(text: string, t: Dictionary): Records {
  const E = t.importExport.err;
  let records: string[][];
  try {
    records = parse(text, { bom: true, delimiter: ",", quote: '"', escape: '"', relax_column_count: true, skip_empty_lines: false, trim: false }) as string[][];
  } catch {
    return { ok: false, message: E.malformed };
  }
  if (records.length === 0) return { ok: false, message: E.empty };
  const [header, ...rest] = records;
  // Row numbers are spreadsheet rows: the header is row 1. Blank/trailing empty rows are skipped but still counted.
  const data = rest.map((cells, i) => ({ row: i + 2, cells })).filter((r) => !r.cells.every((c) => c.trim() === ""));
  if (data.length === 0) return { ok: false, message: E.empty };
  if (data.length > MAX_IMPORT_ROWS) return { ok: false, message: fmt(E.tooManyRows, { max: MAX_IMPORT_ROWS }) };
  return { ok: true, header: header.map((h) => canonicalHeader(h.trim())), data };
}

/** Header issues (missing / unexpected / duplicate / wrong order); empty when the header is exactly right. */
function checkHeader(header: string[], t: Dictionary): ImportIssue[] {
  const E = t.importExport.err;
  const issues: ImportIssue[] = [];
  const known = new Set<string>(IMPORT_HEADERS);
  const seen = new Set<string>();
  for (const h of header) {
    if (seen.has(h)) issues.push({ row: 1, column: h, message: fmt(E.duplicateHeader, { name: h }) });
    seen.add(h);
    if (!known.has(h)) issues.push({ row: 1, column: h || "—", message: fmt(E.unexpectedHeader, { name: h }) });
  }
  for (const h of IMPORT_HEADERS) if (!seen.has(h)) issues.push({ row: 1, column: h, message: fmt(E.missingHeader, { name: h }) });
  if (!issues.length && header.some((h, i) => h !== IMPORT_HEADERS[i])) {
    issues.push({ row: 1, column: IMPORT_HEADERS[0], message: fmt(E.headerOrder, { list: IMPORT_HEADERS.join(", ") }) });
  }
  return issues;
}

type Lookups = {
  category: Map<string, string>;
  brand: Map<string, string>;
  unit: Map<string, string>;
  /** Ids of Base Units that are switched off: not selectable for new products (an import only creates new products). */
  inactiveUnit: Set<string>;
  warehouse: Map<string, string>;
};
/** Names match case-insensitively on the trimmed value (the same names are unique in the database). */
const key = (v: string) => v.trim().normalize("NFC").toLowerCase();
const mapOf = (rows: { id: string; name: string }[]) => new Map(rows.map((r) => [key(r.name), r.id]));

async function loadLookups(db: Prisma.TransactionClient): Promise<Lookups> {
  const [category, brand, unit, warehouse] = await Promise.all([
    db.productCategory.findMany({ select: { id: true, name: true } }),
    db.brand.findMany({ select: { id: true, name: true } }),
    db.productUnit.findMany({ select: { id: true, name: true, active: true } }),
    db.warehouse.findMany({ where: await warehouseFilter(), select: { id: true, name: true } }), // CSV opening stock may only target the user's own warehouses
  ]);
  return { category: mapOf(category), brand: mapOf(brand), unit: mapOf(unit), inactiveUnit: new Set(unit.filter((u) => !u.active).map((u) => u.id)), warehouse: mapOf(warehouse) };
}

/** "0", "0.0", "0.000": a valid zero quantity, treated like a blank one. */
const ZERO_QTY = /^0+(\.0{1,3})?$/;

const FIELD_COLUMN: Partial<Record<keyof ProductFields, Header>> = {
  name: "Product Name",
  code: "SKU",
  cost: "Cost",
  price: "Selling Price",
  stockAlert: "Stock Alert",
  orderTax: "Tax Rate",
  taxType: "Tax Type",
};

/**
 * Validates every row against the real database (names → ids, existing codes) with the SAME Zod
 * schemas and normalization as Create Product. Opening Stock is initial inventory: no supplier is
 * involved anywhere in the import.
 */
export async function validateImport(db: Prisma.TransactionClient, text: string, t: Dictionary): Promise<{ ok: false; message: string } | ({ ok: true } & ImportValidation)> {
  const parsed = parseImportCsv(text, t);
  if (!parsed.ok) return parsed;
  const E = t.importExport.err;
  const base = { ok: true as const, total: parsed.data.length, withStock: 0, rows: [] as ImportRow[] };

  const headerIssues = checkHeader(parsed.header, t);
  if (headerIssues.length) return { ...base, invalidRows: 0, issues: headerIssues, headerInvalid: true };

  const S = makeProductSchemas(t.products.val, t.products.labels);
  const L = await loadLookups(db);
  const issues: ImportIssue[] = [];
  const bad = new Set<number>();
  const add = (row: number, column: string, message: string) => {
    issues.push({ row, column, message });
    bad.add(row);
  };

  // Existing SKUs (CREATE ONLY: an existing product is never touched) and SKUs that are already some unit's stored BARCODE
  // (the identifier registry holds every SKU and barcode; a SKU may never equal another unit's barcode).
  const codes = [...new Set(parsed.data.map((r) => normalizeCode(r.cells[0] ?? "")).filter(Boolean))];
  const existing = new Set((codes.length ? await db.product.findMany({ where: { code: { in: codes } }, select: { code: true } }) : []).map((p) => p.code));
  const asBarcode = new Set((codes.length ? await db.productIdentifier.findMany({ where: { kind: "BARCODE", valueKey: { in: codes.map(identifierKey) } }, select: { valueKey: true } }) : []).map((r) => r.valueKey));
  const firstRowOf = new Map<string, number>();

  for (const { row, cells } of parsed.data) {
    if (cells.length !== IMPORT_HEADERS.length) {
      add(row, IMPORT_HEADERS[0], fmt(E.colCount, { n: IMPORT_HEADERS.length, m: cells.length }));
      continue;
    }
    const v = Object.fromEntries(IMPORT_HEADERS.map((h, i) => [h, cells[i].trim()])) as Record<Header, string>;
    const before = issues.length;

    // Related records are matched by name; nothing is ever created implicitly.
    const resolve = (col: "Category" | "Brand" | "Unit" | "Warehouse", map: Map<string, string>, unknownMsg: string): string => {
      if (!v[col]) {
        if (col !== "Warehouse") add(row, col, fmt(E.required, { label: col }));
        return "";
      }
      const id = map.get(key(v[col]));
      if (!id) add(row, col, fmt(unknownMsg, { v: v[col] }));
      return id ?? "";
    };
    const categoryId = resolve("Category", L.category, E.unknownCategory);
    const brandId = resolve("Brand", L.brand, E.unknownBrand);
    const unitId = resolve("Unit", L.unit, E.unknownUnit);
    if (unitId && L.inactiveUnit.has(unitId)) add(row, "Unit", fmt(E.inactiveUnit, { v: v["Unit"] }));
    const warehouseId = resolve("Warehouse", L.warehouse, E.unknownWarehouse);

    let taxType: "EXCLUSIVE" | "INCLUSIVE" = "EXCLUSIVE";
    if (v["Tax Type"]) {
      const tt = v["Tax Type"].toUpperCase();
      if (tt === "EXCLUSIVE" || tt === "INCLUSIVE") taxType = tt;
      else add(row, "Tax Type", E.taxType);
    }

    // Same schema + normalization as the form. Unresolved ids use a placeholder so only the real problem is reported.
    const f = S.productFieldsSchema.safeParse({
      name: v["Product Name"],
      code: v["SKU"],
      categoryId: categoryId || "x",
      brandId: brandId || "x",
      barcodeSymbology: IMPORT_BARCODE,
      cost: v["Cost"],
      price: v["Selling Price"],
      productUnitId: unitId || "x",
      saleUnitId: unitId || "x",
      purchaseUnitId: unitId || "x",
      stockAlert: v["Stock Alert"] || "0",
      orderTax: v["Tax Rate"] || "0",
      taxType,
      quantityLimitation: "",
      notes: "",
    });
    if (!f.success) {
      const done = new Set<string>();
      for (const i of f.error.issues) {
        const col = FIELD_COLUMN[i.path[0] as keyof ProductFields];
        if (col && !done.has(col)) {
          done.add(col);
          add(row, col, i.message);
        }
      }
    }

    // Opening Stock is initial inventory. Blank or zero = no stock (Warehouse stays optional, and nothing is
    // recorded); a quantity above zero needs a real warehouse. Negative / malformed quantities are errors.
    let stock: ImportRow["stock"] = null;
    if (v["Opening Stock"] && !ZERO_QTY.test(v["Opening Stock"])) {
      if (!v["Warehouse"]) add(row, "Warehouse", E.stockNeedsWarehouse);
      const q = S.openingStockSchema.shape.quantity.safeParse(v["Opening Stock"]);
      if (!q.success) add(row, "Opening Stock", q.error.issues[0].message);
      else if (warehouseId) stock = { warehouseId, quantity: q.data };
    }

    if (f.success) {
      const code = f.data.code;
      if (firstRowOf.has(code)) add(row, "SKU", fmt(E.dupInFile, { n: firstRowOf.get(code)! }));
      else firstRowOf.set(code, row);
      if (existing.has(code)) add(row, "SKU", E.existsDb);
      else if (asBarcode.has(identifierKey(code))) add(row, "SKU", E.skuIsBarcode);
    }

    if (issues.length === before && f.success) base.rows.push({ row, fields: f.data, stock });
  }
  base.withStock = base.rows.filter((r) => r.stock).length;
  // Rows with opening stock that are otherwise valid still count as valid in the preview.
  return { ...base, invalidRows: bad.size, issues: issues.sort((a, b) => a.row - b.row), headerInvalid: false };
}
