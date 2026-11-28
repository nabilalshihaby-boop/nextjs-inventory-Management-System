import { warehouseFilter } from "@/lib/access-scope";
import { parse } from "csv-parse/sync";
import type { Prisma } from "@/app/generated/prisma/client";
import { fmt } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";
import { makeProductSchemas, normalizeCode, type ProductFields } from "@/lib/products";
import { identifierKey } from "@/lib/product-identifiers";
import { normalizeBarcode, MAX_BARCODE_LENGTH } from "@/lib/barcode";
import { neutralize } from "@/lib/csv";
import { PRODUCT_HANDLE_FALLBACK, HANDLE_MAX, VARIANT_VALUE_MAX, FAMILY_NAME_MAX, HS_MAX, HS_MIN, cleanText, compareKey, describeVariant, effectiveHsCode, dimensionsOf, handleKeyOf, handleProblem, hasControlChars, nextFreeHandle, normalizeHandle, normalizeHsCode, slugifyHandle, variantKeyOf } from "@/lib/family-core";
import { lockFamily } from "@/lib/product-families";
import { GROUP_HS_HEADER, LEGACY_COLUMNS, SIZE_DIMENSION, groupNameOf, importColumns, isLegacyHeader, looksLegacy, type ImportColumn, type LegacyField, type ImportMode, type PreviewGroup, type PreviewRow } from "@/lib/product-import-core";

// Product CSV import — parsing and validation (server-only). Import is CREATE ONLY. The same function validates for the preview and again
// inside the confirming transaction (nothing from the preview is reused), and what it plans is written through createProductRecord
// (lib/product-create.ts), exactly like the Create Product form. Variant attributes are only ever read from their own columns, never
// guessed from the SKU or the name.

export const MAX_IMPORT_MB = 5;
export const MAX_IMPORT_BYTES = MAX_IMPORT_MB * 1024 * 1024;
export const MAX_IMPORT_ROWS = 1000;
/** Barcode symbology isn't a CSV column; imported products use the form's first option. */
export const IMPORT_BARCODE = "CODE128" as const;

export type ImportIssue = { row: number; column: string; message: string };
export type ImportRequest = { mode: ImportMode; familyId: string | null };

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
  return { ok: true, header: header.map((h) => h.trim().normalize("NFC")), data };
}

/**
 * How a template column is NAMED to the user. The file's header text is a technical contract and never changes; the one column whose name
 * is an ordinary word in the interface ("Handle") is shown in the user's language.
 */
const columnName = (header: string, t: Dictionary) => (header === "Handle" ? t.importExport.identity.handle : header);

/** Header problems (missing / unexpected / duplicate / wrong order); empty when the header is exactly right. */
function checkHeader(header: string[], columns: ImportColumn[], t: Dictionary): ImportIssue[] {
  const E = t.importExport.err;
  const issues: ImportIssue[] = [];
  // The template writes a header that a spreadsheet could read as a formula with a leading apostrophe: accept both forms.
  const expected = columns.map((c) => c.header.normalize("NFC"));
  const found = header.map((h) => expected.find((x) => x === h || neutralize(x) === h) ?? h);
  const known = new Set(expected);
  const seen = new Set<string>();
  for (const h of found) {
    if (seen.has(h)) issues.push({ row: 1, column: columnName(h, t), message: fmt(E.duplicateHeader, { name: columnName(h, t) }) });
    seen.add(h);
    if (!known.has(h)) issues.push({ row: 1, column: columnName(h, t) || "—", message: fmt(E.unexpectedHeader, { name: columnName(h, t) }) });
  }
  for (const h of expected) if (!seen.has(h)) issues.push({ row: 1, column: columnName(h, t), message: fmt(E.missingHeader, { name: columnName(h, t) }) });
  if (!issues.length && found.some((h, i) => h !== expected[i])) issues.push({ row: 1, column: columnName(expected[0], t), message: fmt(E.headerOrder, { list: expected.map((h) => columnName(h, t)).join(", ") }) });
  return issues;
}

type Client = Prisma.TransactionClient;

/** Names match case-insensitively on the trimmed value (the same names are unique in the database). */
const key = (v: string) => v.trim().normalize("NFC").toLowerCase();
const mapOf = (rows: { id: string; name: string }[]) => new Map(rows.map((r) => [key(r.name), r.id]));

async function loadLookups(db: Client) {
  const [category, brand, unit, warehouse] = await Promise.all([
    db.productCategory.findMany({ select: { id: true, name: true } }),
    db.brand.findMany({ select: { id: true, name: true } }),
    db.productUnit.findMany({ select: { id: true, name: true, active: true } }),
    db.warehouse.findMany({ where: await warehouseFilter(), select: { id: true, name: true } }), // opening stock may only target the user's own warehouses
  ]);
  return { category: mapOf(category), brand: mapOf(brand), unit: mapOf(unit), inactiveUnit: new Set(unit.filter((u) => !u.active).map((u) => u.id)), warehouse: mapOf(warehouse) };
}

/** "0", "0.0", "0.000": a valid zero quantity, treated like a blank one. */
const ZERO_QTY = /^0+(\.0{1,3})?$/;

const FIELD_COLUMN: Partial<Record<keyof ProductFields, string>> = {
  name: "Product Name",
  code: "SKU",
  cost: "Purchase Price",
  price: "Sale Price",
  stockAlert: "Stock Alert",
  orderTax: "Tax Rate",
  taxType: "Tax Type",
  notes: "Description",
};

export type PlannedRow = {
  row: number;
  status: "new" | "unchanged";
  fields: ProductFields;
  barcode: string | null;
  hsCode: string | null;
  /** Standalone products only. */
  handle: string | null;
  stock: { warehouseId: string; quantity: string } | null;
  /** A family member: an existing family's id, or the key of one of `newGroups`. */
  variant: { familyId: string | null; groupKey: string; values: string[] } | null;
};
export type NewGroup = { key: string; name: string; handle: string; dims: string[]; hsCode: string | null };
export type ImportPlan = { rows: PlannedRow[]; newGroups: NewGroup[] };
export type ImportValidation = {
  total: number;
  /** Distinct rows that have at least one problem. */
  invalidRows: number;
  withStock: number;
  /** Products the confirmation would create. */
  creating: number;
  /** Existing-group mode: rows that already exist exactly as written (nothing happens for them). */
  unchanged: number;
  issues: ImportIssue[];
  /** True when the header row itself is wrong (no row was checked). */
  headerInvalid: boolean;
  /** The file is the earlier one-size layout: how each of its columns was read. null = a current template. */
  legacy: LegacyField[] | null;
  plan: ImportPlan;
  preview: { rows: PreviewRow[]; groups: PreviewGroup[] };
};

type Family = { id: string; name: string; handle: string; dims: string[]; hsCode: string | null };
type Group = {
  key: string;
  name: string;
  existing: Family | null;
  dims: string[];
  rows: number[];
  /** Handles typed in this group's rows (normalized), with the row that first gave each. */
  handles: Map<string, number>;
  handle: string;
  generated: boolean;
  /** Group default HS Codes typed in this group's rows (normalized), with the row that first gave each. */
  defaults: Map<string, number>;
};

export type ValidateResult = { ok: false; message: string } | ({ ok: true } & ImportValidation);

/**
 * Validates every row against the real database with the SAME Zod schemas and normalization as Create Product. Opening Quantity is
 * initial inventory: no supplier is involved anywhere in the import. `lock` (confirmation) locks the family rows that rows are added to.
 */
export async function validateImport(db: Client, text: string, t: Dictionary, request: ImportRequest, lock = false): Promise<ValidateResult> {
  const E = t.importExport.err;

  // The selected group is re-read here every time: its dimensions and handle come from the database, never from the request.
  let selected: Family | null = null;
  if (request.mode === "group") {
    if (!request.familyId) return { ok: false, message: E.chooseGroup };
    const f = lock ? await lockFamily(db, request.familyId) : await db.productFamily.findUnique({ where: { id: request.familyId }, select: { id: true, name: true, handle: true, hsCode: true, dimension1: true, dimension2: true, dimension3: true } });
    if (!f) return { ok: false, message: E.groupGone };
    selected = { id: f.id, name: f.name, handle: f.handle, dims: dimensionsOf(f), hsCode: f.hsCode };
    if (!selected.dims.length) return { ok: false, message: E.groupNoOptions };
  }

  const parsed = parseImportCsv(text, t);
  if (!parsed.ok) return parsed;
  const columns = importColumns(request.mode, selected?.dims);
  const base = { ok: true as const, total: parsed.data.length, withStock: 0, creating: 0, unchanged: 0, plan: { rows: [], newGroups: [] } as ImportPlan, preview: { rows: [] as PreviewRow[], groups: [] as PreviewGroup[] }, legacy: null as LegacyField[] | null };
  // The earlier standalone file: recognised exactly, then read into the current columns and validated like any other file.
  let legacy: LegacyField[] | null = null;
  /** Cells a data row must have (the file's own column count). */
  let expectedCells = columns.length;
  /** Current column name -> the name the file used, so problems are reported in the file's own words. */
  const shownAs = new Map<string, string>();
  if (request.mode === "standalone" && isLegacyHeader(parsed.header)) {
    legacy = parsed.header.map((from, i) => ({ from, to: LEGACY_COLUMNS[i][1] }));
    expectedCells = parsed.header.length;
    for (const m of legacy) shownAs.set(m.to, m.from);
    const source = new Map(legacy.map((m, i) => [m.to, i]));
    parsed.data = parsed.data.map((r) => (r.cells.length !== expectedCells ? r : { row: r.row, cells: columns.map((c) => (source.has(c.header) ? r.cells[source.get(c.header)!] : "")), source: r.cells.length }));
  } else {
    const wanted = request.mode === "standalone" && looksLegacy(parsed.header) ? LEGACY_COLUMNS.map(([h]) => ({ header: h, guide: "sku" as const, required: true })) : columns;
    const headerIssues = checkHeader(parsed.header, wanted, t);
    if (headerIssues.length) return { ...base, invalidRows: 0, issues: headerIssues, headerInvalid: true, legacy: null };
  }

  const S = makeProductSchemas(t.products.val, t.products.labels);
  const L = await loadLookups(db);
  const issues: ImportIssue[] = [];
  const bad = new Set<number>();
  const add = (row: number, column: string, message: string) => {
    issues.push({ row, column: columnName(shownAs.get(column) ?? column, t), message });
    bad.add(row);
  };

  const at = (cells: string[], header: string) => {
    const i = columns.findIndex((c) => c.header === header);
    return i < 0 ? "" : (cells[i] ?? "").trim();
  };

  // Every SKU and barcode in the file, looked up once in the identifier registry (which holds all SKUs and unit barcodes).
  const wanted = [...new Set(parsed.data.flatMap((r) => [normalizeCode(at(r.cells, "SKU")), at(r.cells, "Barcode")]).filter(Boolean).map(identifierKey))];
  const registry = new Map(
    (wanted.length ? await db.productIdentifier.findMany({ where: { valueKey: { in: wanted } }, select: { valueKey: true, kind: true, product: { select: { id: true, code: true, active: true } } } }) : []).map((r) => [r.valueKey, r]),
  );
  // The canonical columns are read as well as the registry (as before): a row the registry somehow missed is still refused here, at preview.
  const codes = [...new Set(parsed.data.flatMap((r) => [normalizeCode(at(r.cells, "SKU")), normalizeCode(at(r.cells, "Barcode"))]).filter(Boolean))];
  const barcodes = [...new Set(parsed.data.flatMap((r) => [at(r.cells, "Barcode"), at(r.cells, "SKU")]).filter(Boolean))];
  const bySku = new Map((codes.length ? await db.product.findMany({ where: { code: { in: codes } }, select: { code: true, active: true } }) : []).map((p) => [identifierKey(p.code), p]));
  const byBarcode = new Map(
    (barcodes.length ? await db.productUnitConversion.findMany({ where: { barcode: { in: barcodes } }, select: { barcode: true, product: { select: { code: true } } } }) : []).map((c) => [identifierKey(c.barcode!), c.product.code]),
  );
  /** identifierKey -> the row that already claims it in this file. */
  const claimed = new Map<string, { row: number; kind: "SKU" | "Barcode" }>();

  // Families this file can touch, and every handle already in use (products and families share them).
  const families: Family[] =
    request.mode === "model" ? (await db.productFamily.findMany({ select: { id: true, name: true, handle: true, hsCode: true, dimension1: true, dimension2: true, dimension3: true } })).map((f) => ({ id: f.id, name: f.name, handle: f.handle, dims: dimensionsOf(f), hsCode: f.hsCode })) : [];
  const familyByName = new Map(families.map((f) => [compareKey(f.name), f]));
  const takenHandles = new Set((await db.productHandle.findMany({ select: { handleKey: true } })).map((r) => r.handleKey));

  // Members of existing families (their combinations are unique).
  const memberCache = new Map<string, Map<string, { code: string; active: boolean }>>();
  const membersOf = async (familyId: string) => {
    let m = memberCache.get(familyId);
    if (!m) {
      const rows = await db.product.findMany({ where: { familyId }, select: { code: true, active: true, variantKey: true } });
      m = new Map(rows.filter((r) => r.variantKey).map((r) => [r.variantKey!, { code: r.code, active: r.active }]));
      memberCache.set(familyId, m);
    }
    return m;
  };

  const groups = new Map<string, Group>();
  const combos = new Map<string, number>(); // groupKey + variantKey -> first row
  /** Standalone handle typed in the file -> first row. */
  const typedHandles = new Map<string, number>();
  type Draft = Omit<PlannedRow, "handle"> & { typedHandle: string | null };
  const drafts: Draft[] = [];

  /** A typed handle, normalized and checked. "" = none typed, null = invalid (already reported). */
  const readHandle = (row: number, raw: string): string | null => {
    if (!raw) return "";
    const h = normalizeHandle(raw);
    const problem = handleProblem(h);
    if (problem) {
      add(row, "Handle", problem === "long" ? fmt(E.handleLong, { max: HANDLE_MAX }) : E.handleFormat);
      return null;
    }
    return h;
  };

  const readValue = (row: number, column: string, raw: string): string => {
    if (hasControlChars(raw)) {
      add(row, column, fmt(E.valueChars, { label: column }));
      return "";
    }
    const v = cleanText(raw);
    if (!v) add(row, column, fmt(E.required, { label: column }));
    else if (v.length > VARIANT_VALUE_MAX) {
      add(row, column, fmt(E.valueLong, { label: column, max: VARIANT_VALUE_MAX }));
      return "";
    }
    return v;
  };

  for (const record of parsed.data) {
    const { row, cells } = record;
    const remapped = "source" in record; // a legacy row with the right number of cells
    if (legacy ? !remapped : cells.length !== expectedCells) {
      add(row, legacy ? "SKU" : columns[0].header, fmt(E.colCount, { n: expectedCells, m: cells.length })); // legacy: the file's own SKU column
      continue;
    }
    const v = (header: string) => at(cells, header);
    const before = issues.length;

    // Related records are matched by name; nothing is ever created implicitly.
    const resolve = (col: "Category" | "Brand" | "Base Unit" | "Warehouse", map: Map<string, string>, unknownMsg: string): string => {
      if (!v(col)) {
        if (col !== "Warehouse") add(row, col, fmt(E.required, { label: col }));
        return "";
      }
      const id = map.get(key(v(col)));
      if (!id) add(row, col, fmt(unknownMsg, { v: v(col) }));
      return id ?? "";
    };
    const categoryId = resolve("Category", L.category, E.unknownCategory);
    const brandId = resolve("Brand", L.brand, E.unknownBrand);
    const unitId = resolve("Base Unit", L.unit, E.unknownUnit);
    if (unitId && L.inactiveUnit.has(unitId)) add(row, "Base Unit", fmt(E.inactiveUnit, { v: v("Base Unit") }));
    const warehouseId = resolve("Warehouse", L.warehouse, E.unknownWarehouse);

    let taxType: "EXCLUSIVE" | "INCLUSIVE" = "EXCLUSIVE";
    if (v("Tax Type")) {
      const tt = v("Tax Type").toUpperCase();
      if (tt === "EXCLUSIVE" || tt === "INCLUSIVE") taxType = tt;
      else add(row, "Tax Type", E.taxType);
    }

    // Same schema + normalization as the form. Unresolved ids use a placeholder so only the real problem is reported.
    const f = S.productFieldsSchema.safeParse({
      name: v("Product Name").normalize("NFC"),
      code: v("SKU"),
      categoryId: categoryId || "x",
      brandId: brandId || "x",
      barcodeSymbology: IMPORT_BARCODE,
      cost: v("Purchase Price"),
      price: v("Sale Price"),
      productUnitId: unitId || "x",
      saleUnitId: unitId || "x",
      purchaseUnitId: unitId || "x",
      stockAlert: v("Stock Alert") || "0",
      orderTax: v("Tax Rate") || "0",
      taxType,
      quantityLimitation: "",
      notes: v("Description").normalize("NFC"),
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

    // Opening Quantity is initial inventory. Blank or zero = no stock (Warehouse stays optional, and nothing is
    // recorded); a quantity above zero needs a real warehouse. Negative / malformed quantities are errors.
    let stock: PlannedRow["stock"] = null;
    if (v("Opening Quantity") && !ZERO_QTY.test(v("Opening Quantity"))) {
      if (!v("Warehouse")) add(row, "Warehouse", E.stockNeedsWarehouse);
      const q = S.openingStockSchema.shape.quantity.safeParse(v("Opening Quantity"));
      if (!q.success) add(row, "Opening Quantity", q.error.issues[0].message);
      else if (warehouseId) stock = { warehouseId, quantity: q.data };
    }

    const hs = normalizeHsCode(v("HS Code"));
    if (!hs.ok) add(row, "HS Code", fmt(E.hsCode, { min: HS_MIN, max: HS_MAX }));

    // ---- grouping and variant values ----
    let variant: PlannedRow["variant"] = null;
    let typedHandle: string | null = null;
    let unchanged = false;
    const code = f.success ? f.data.code : normalizeCode(v("SKU"));

    if (request.mode === "standalone") {
      const h = readHandle(row, v("Handle"));
      if (h) {
        if (typedHandles.has(h)) add(row, "Handle", fmt(E.handleDupFile, { n: typedHandles.get(h)! }));
        else if (takenHandles.has(handleKeyOf(h))) add(row, "Handle", fmt(E.handleTaken, { v: h }));
        else typedHandles.set(h, row);
        typedHandle = h;
      }
    } else if (request.mode === "model") {
      const model = readValue(row, "Model", v("Model"));
      const color = readValue(row, "Color", v("Color"));
      const size = readValue(row, "Size", v("Size"));
      const h = readHandle(row, v("Handle"));
      if (model && color) {
        const groupKey = `${compareKey(model)}\u001f${compareKey(color)}`;
        let g = groups.get(groupKey);
        if (!g) {
          const name = groupNameOf(model, color);
          const existing = familyByName.get(compareKey(name)) ?? null;
          g = { key: groupKey, name: existing?.name ?? name, existing, dims: [SIZE_DIMENSION], rows: [], handles: new Map(), handle: "", generated: false, defaults: new Map() };
          // Two different Model + Color pairs must not end up with one name ("A - B" + "C" and "A" + "B - C").
          const twin = [...groups.values()].find((x) => compareKey(x.name) === compareKey(name));
          if (twin) add(row, "Color", fmt(E.groupAmbiguous, { name, n: twin.rows[0] }));
          groups.set(groupKey, g);
        }
        g.rows.push(row);
        const rawDefault = normalizeHsCode(v(GROUP_HS_HEADER));
        if (!rawDefault.ok) add(row, GROUP_HS_HEADER, fmt(E.hsCode, { min: HS_MIN, max: HS_MAX }));
        else if (rawDefault.value) {
          if (!g.defaults.has(rawDefault.value)) g.defaults.set(rawDefault.value, row);
          if (g.defaults.size > 1) add(row, GROUP_HS_HEADER, fmt(E.hsInconsistent, { name: g.name, n: [...g.defaults.values()][0] }));
          // An import never changes an existing group.
          if (g.existing && g.existing.hsCode !== rawDefault.value) add(row, GROUP_HS_HEADER, g.existing.hsCode ? fmt(E.groupHsMismatch, { name: g.existing.name, v: g.existing.hsCode }) : fmt(E.groupHsMissing, { name: g.existing.name }));
        }
        if (g.name.length > FAMILY_NAME_MAX) add(row, "Model", fmt(E.groupNameLong, { max: FAMILY_NAME_MAX }));
        if (g.existing && g.existing.dims.map(compareKey).join("\u001f") !== compareKey(SIZE_DIMENSION)) add(row, "Model", fmt(E.groupIncompatible, { name: g.existing.name, dims: g.existing.dims.join(", ") || "—" }));
        if (h) {
          if (!g.handles.has(h)) g.handles.set(h, row);
          if (g.handles.size > 1) add(row, "Handle", fmt(E.handleInconsistent, { name: g.name, n: [...g.handles.values()][0] }));
          if (g.existing && handleKeyOf(g.existing.handle) !== handleKeyOf(h)) add(row, "Handle", fmt(E.groupHandleMismatch, { name: g.existing.name, v: g.existing.handle }));
        }
        if (size) {
          const variantKey = variantKeyOf([size]);
          const combo = `${groupKey}\u001f${variantKey}`;
          if (combos.has(combo)) add(row, "Size", fmt(E.comboDupFile, { n: combos.get(combo)! }));
          else combos.set(combo, row);
          if (g.existing) {
            const member = (await membersOf(g.existing.id)).get(variantKey);
            if (member) add(row, "Size", fmt(member.active ? E.comboExists : E.comboExistsInactive, { sku: member.code }));
          }
          variant = { familyId: g.existing?.id ?? null, groupKey, values: [size] };
        }
      }
    } else {
      const values = columns.filter((c) => c.dimension).map((c) => readValue(row, c.header, v(c.header)));
      if (values.every(Boolean)) {
        const variantKey = variantKeyOf(values);
        if (combos.has(variantKey)) add(row, columns[0].header, fmt(E.comboDupFile, { n: combos.get(variantKey)! }));
        else combos.set(variantKey, row);
        const member = (await membersOf(selected!.id)).get(variantKey);
        if (member) {
          // The very same variant (same options, same SKU, still active) is left exactly as it is; anything else is a conflict.
          if (member.active && member.code === code) unchanged = true;
          else add(row, columns[0].header, fmt(member.active ? E.comboExists : E.comboExistsInactive, { sku: member.code }));
        }
        variant = { familyId: selected!.id, groupKey: selected!.id, values };
      }
    }

    // ---- SKU and barcode: one namespace, in the file and in the database ----
    let barcode: string | null = null;
    if (v("Barcode")) {
      const c = normalizeBarcode(v("Barcode"));
      if (!c.ok) add(row, "Barcode", c.reason === "tooLong" ? fmt(t.barcode.err.tooLong, { max: MAX_BARCODE_LENGTH }) : t.barcode.err.chars);
      else barcode = c.value;
    }
    if (f.success) {
      const skuKey = identifierKey(code);
      const inFile = claimed.get(skuKey);
      if (inFile) add(row, "SKU", fmt(inFile.kind === "SKU" ? E.dupInFile : E.skuIsBarcodeInFile, { n: inFile.row }));
      else claimed.set(skuKey, { row, kind: "SKU" });
      const owner = registry.get(skuKey);
      const product = bySku.get(skuKey);
      if (!unchanged) {
        if (product) add(row, "SKU", product.active ? E.existsDb : E.existsInactive);
        else if (owner?.kind === "BARCODE" || byBarcode.has(skuKey)) add(row, "SKU", E.skuIsBarcode);
        else if (owner) add(row, "SKU", owner.product.active ? E.existsDb : E.existsInactive);
      }
      if (barcode) {
        const barKey = identifierKey(barcode);
        if (barKey !== skuKey) {
          // (a barcode equal to the row's own SKU is the SKU's alias on the base unit, so there is nothing else to check)
          const used = claimed.get(barKey);
          if (used) add(row, "Barcode", fmt(used.kind === "SKU" ? E.barcodeIsSkuInFile : E.barcodeDupFile, { n: used.row }));
          else claimed.set(barKey, { row, kind: "Barcode" });
          const holder = registry.get(barKey)?.product.code ?? byBarcode.get(barKey) ?? bySku.get(barKey)?.code;
          if (!unchanged && holder) add(row, "Barcode", fmt(E.barcodeUsed, { v: barcode, sku: holder }));
        }
      }
    }

    if (issues.length === before && f.success && hs.ok) drafts.push({ row, status: unchanged ? "unchanged" : "new", fields: f.data, barcode, hsCode: hs.value, stock: unchanged ? null : stock, variant, typedHandle });
  }

  // ---- handles for what is new (typed ones first, so a generated one never takes a typed one) ----
  const promised = new Set<string>([...takenHandles, ...typedHandles.keys()]);
  for (const g of groups.values()) for (const h of g.handles.keys()) if (!g.existing) promised.add(handleKeyOf(h));
  const typedByGroup = new Map<string, string>(); // handle -> group name, among new groups
  for (const g of groups.values()) {
    if (g.existing) {
      g.handle = g.existing.handle;
      continue;
    }
    const typed = [...g.handles.keys()][0];
    if (typed) {
      const row = g.handles.get(typed)!;
      if (takenHandles.has(handleKeyOf(typed))) add(row, "Handle", fmt(E.handleTaken, { v: typed }));
      else if (typedByGroup.has(typed)) add(row, "Handle", fmt(E.handleSharedGroups, { v: typed, name: typedByGroup.get(typed)! }));
      else typedByGroup.set(typed, g.name);
      g.handle = typed;
    }
  }
  const generate = (name: string, fallback: string) => {
    const h = nextFreeHandle(slugifyHandle(name, fallback), promised);
    promised.add(h);
    return h;
  };
  for (const g of groups.values()) {
    if (g.existing || g.handle) continue;
    const first = drafts.find((d) => d.variant?.groupKey === g.key);
    if (!first) continue; // no valid row: nothing would be created
    g.handle = generate(g.name.replace(" - ", " "), PRODUCT_HANDLE_FALLBACK);
    g.generated = true;
  }
  const rows: (PlannedRow & { generated: boolean })[] = drafts
    .filter((d) => !bad.has(d.row))
    .map(({ typedHandle, ...d }) => {
      const standalone = request.mode === "standalone";
      const handle = standalone ? (typedHandle ?? generate(d.fields.name, PRODUCT_HANDLE_FALLBACK)) : null;
      return { ...d, handle, generated: standalone && !typedHandle };
    });

  // ---- HS Code: a group's default, and per-product overrides ----
  const defaultOf = (k: string): string | null => (selected ? selected.hsCode : (groups.get(k)!.existing?.hsCode ?? (groups.get(k)!.existing ? null : ([...groups.get(k)!.defaults.keys()][0] ?? null))));
  for (const r of rows) {
    // A row that repeats its group's default simply inherits it; only a DIFFERENT code is stored as the product's own override.
    if (r.variant && r.hsCode && r.hsCode === defaultOf(r.variant.groupKey)) r.hsCode = null;
  }

  // ---- what the confirmation would do ----
  const creating = rows.filter((r) => r.status === "new");
  const newGroups: NewGroup[] = [...groups.values()].filter((g) => !g.existing && creating.some((r) => r.variant?.groupKey === g.key)).map((g) => ({ key: g.key, name: g.name, handle: g.handle, dims: g.dims, hsCode: defaultOf(g.key) }));
  const groupInfo = (k: string) => (selected ? { name: selected.name, handle: selected.handle, generated: false, existing: true, hsCode: defaultOf(k), dimensions: selected.dims } : { name: groups.get(k)!.name, handle: groups.get(k)!.handle, generated: groups.get(k)!.generated, existing: !!groups.get(k)!.existing, hsCode: defaultOf(k), dimensions: groups.get(k)!.dims });
  const previewGroups = new Map<string, PreviewGroup>();
  for (const r of creating) {
    if (!r.variant) continue;
    const info = groupInfo(r.variant.groupKey);
    const g = previewGroups.get(r.variant.groupKey) ?? { ...info, variants: [] };
    g.variants.push({ row: r.row, sku: r.fields.code, variant: describeVariant(info.dimensions, r.variant.values) });
    previewGroups.set(r.variant.groupKey, g);
  }
  const previewRows: PreviewRow[] = rows.map((r) => ({
    row: r.row,
    sku: r.fields.code,
    name: r.fields.name,
    status: r.status,
    handle: r.handle,
    generated: r.generated,
    group: r.variant ? groupInfo(r.variant.groupKey).name : null,
    variant: r.variant ? describeVariant(groupInfo(r.variant.groupKey).dimensions, r.variant.values) : null,
    quantity: r.stock?.quantity ?? null,
    hsCode: effectiveHsCode(r.hsCode, r.variant ? defaultOf(r.variant.groupKey) : null),
    hsSource: r.hsCode ? "own" : r.variant && defaultOf(r.variant.groupKey) ? "group" : "none",
  }));

  return {
    ...base,
    invalidRows: bad.size,
    withStock: creating.filter((r) => r.stock).length,
    creating: creating.length,
    unchanged: rows.length - creating.length,
    issues: issues.sort((a, b) => a.row - b.row),
    headerInvalid: false,
    legacy,
    plan: { rows: rows.map((r): PlannedRow => ({ row: r.row, status: r.status, fields: r.fields, barcode: r.barcode, hsCode: r.hsCode, handle: r.handle, stock: r.stock, variant: r.variant })), newGroups },
    preview: { rows: previewRows, groups: [...previewGroups.values()] },
  };
}
