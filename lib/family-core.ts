// Pure rules of Product Families and variant attributes (safe to import from client components — no database access).
//
// A family is an OPTIONAL grouping layer: it has a display name and up to three named dimensions (Color, Size, ...). A product either has
// no family (standalone — every legacy product) or belongs to exactly one family and then carries ONE value for each configured
// dimension and none for the others. The combination of a member's values is normalized into `variantKey`; the database holds a unique
// index on (familyId, variantKey), so two members of one family can never share a combination, whatever the letter case or spacing.

export const MAX_DIMENSIONS = 3;
export const FAMILY_NAME_MAX = 120;
export const DIMENSION_NAME_MAX = 40;
export const VARIANT_VALUE_MAX = 60;

/** Joins the normalized values of a combination (a control character that no value can contain). */
const SEP = "\u001f";

/** Removes control characters, normalizes Unicode (NFC) and collapses every run of whitespace into one space; trims. */
export const cleanText = (v: string) =>
  v
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** True when a raw string carries a control character (rejected rather than silently cleaned for names and values). */
export const hasControlChars = (v: string) => /[\u0000-\u001f\u007f-\u009f]/.test(v);

/** Comparison form of any family text: trimmed, NFC, whitespace collapsed, case-insensitive. */
export const compareKey = (v: string) => cleanText(v).toLowerCase();

/** A family's dimensions as an ordered list (the configured ones only, in order). */
export type FamilyDims = { dimension1: string | null; dimension2: string | null; dimension3: string | null };
export const dimensionsOf = (f: FamilyDims): string[] => [f.dimension1, f.dimension2, f.dimension3].filter((d): d is string => !!d);

/** The three value slots of a product (null = unused). */
export type VariantValues = { variantValue1: string | null; variantValue2: string | null; variantValue3: string | null };
export const valuesOf = (p: VariantValues): string[] => [p.variantValue1, p.variantValue2, p.variantValue3].filter((v): v is string => !!v);

/** The normalized combination key stored in `products.variantKey` (values already validated, one per dimension). */
export const variantKeyOf = (values: readonly string[]): string => values.map(compareKey).join(SEP);

/** "Color: Red · Size: M" — the readable description of one member's variant. */
export function describeVariant(dims: readonly string[], values: readonly string[]): string {
  return dims.map((d, i) => `${d}: ${values[i] ?? ""}`).join(" · ");
}

/** The three nullable column pairs in write form: unused slots are explicitly null. */
export function variantColumns(values: readonly string[]): VariantValues & { variantKey: string | null } {
  return {
    variantValue1: values[0] ?? null,
    variantValue2: values[1] ?? null,
    variantValue3: values[2] ?? null,
    variantKey: values.length ? variantKeyOf(values) : null,
  };
}

/** What a family selector option carries to the product form. */
export type FamilyOption = { id: string; name: string; dimensions: string[]; handle: string; hsCode: string | null };

/** A family as listed on the Families page. */
export type FamilyRow = { id: string; name: string; handle: string; hsCode: string | null; dimensions: string[]; products: number };

// ---------------------------------------------------------------------------------------------
// Family handle (Shopify-compatible group identity; see ProductFamily.handle in the schema)
// ---------------------------------------------------------------------------------------------

export const HANDLE_MAX = 255;
/** Generated handles stay short; the suffix for collisions is added after this cut. */
export const HANDLE_GENERATED_MAX = 80;
/** Used when a name has nothing transliterable (for example an Arabic-only name). */
export const HANDLE_FALLBACK = "family";
/** Lowercase letters and digits in hyphen-separated groups: no leading, trailing or doubled hyphen. */
export const HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The database-unique, case-insensitive form of a handle. */
export const handleKeyOf = (h: string) => h.trim().toLowerCase();

/** Deterministic handle candidate from a display name: accents removed, lowercase ASCII, hyphen separated; the fallback when empty. */
export function slugifyHandle(name: string, fallback: string = HANDLE_FALLBACK): string {
  const s = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, HANDLE_GENERATED_MAX)
    .replace(/-+$/, "");
  return s || fallback;
}

/** Used for a standalone product whose name has nothing transliterable. */
export const PRODUCT_HANDLE_FALLBACK = "product";

/** A handle typed by a user or read from a file: trimmed, NFC, lowercase. Validate the result with `handleProblem`. */
export const normalizeHandle = (v: string) => v.normalize("NFC").trim().toLowerCase();

// ---------------------------------------------------------------------------------------------
// HS Code (supplied by the business; never generated)
// ---------------------------------------------------------------------------------------------

export const HS_MIN = 4;
export const HS_MAX = 10;
/** The code that applies to a product: its own, else its group's default, else none. */
export const effectiveHsCode = (own: string | null | undefined, groupDefault: string | null | undefined): string | null => own || groupDefault || null;

/** Arabic-Indic and extended Arabic-Indic digits to ASCII (NFKC handles full-width digits). */
const asciiDigits = (v: string) => v.replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/[\u06f0-\u06f9]/g, (c) => String(c.charCodeAt(0) - 0x6f0));
/** Blank = none. Otherwise separators people type (spaces, dots, hyphens) are removed and 4-10 digits must remain. */
export function normalizeHsCode(raw: string): { ok: true; value: string | null } | { ok: false } {
  if (!raw.trim()) return { ok: true, value: null };
  const v = asciiDigits(raw.normalize("NFKC")).replace(/[\s.\-]/g, "");
  return new RegExp(`^[0-9]{${HS_MIN},${HS_MAX}}$`).test(v) ? { ok: true, value: v } : { ok: false };
}

/** First free handle for `base`: base, base-2, base-3, ... (`taken` holds lowercase handles already in use). */
export function nextFreeHandle(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export type HandleProblem = "required" | "long" | "format";
/** Strict check of a supplied handle EXACTLY as given (no cleaning, no case change). null = valid. */
export function handleProblem(h: string): HandleProblem | null {
  if (!h) return "required";
  if (h.length > HANDLE_MAX) return "long";
  return HANDLE_PATTERN.test(h) ? null : "format";
}
