// Barcode values — the ONE definition shared by the browser (instant feedback) and the server (authoritative).
// A barcode identifies a PRODUCT UNIT (product + one of its conversions), is stored once per unit and is unique
// across every product. Code 128 (subset B) carries any printable ASCII character, so that is the allowed set.
//
// Normalization is deliberately minimal and the same everywhere: surrounding whitespace is trimmed and nothing
// else changes (case is kept; the database compares case-insensitively, so "ab-1" and "AB-1" cannot both exist and a
// scan matches whichever case was printed).

/** Longest barcode accepted. Keeps the printed symbol wide enough to scan reliably on the smallest label (see lib/code128.ts). */
export const MAX_BARCODE_LENGTH = 20;

export type BarcodeCheck = { ok: true; value: string } | { ok: false; reason: "empty" | "tooLong" | "chars" };

/** Trim and validate a typed/scanned barcode. Control characters, non-ASCII text and over-long values are refused. */
export function normalizeBarcode(raw: unknown): BarcodeCheck {
  if (typeof raw !== "string") return { ok: false, reason: "chars" };
  const v = raw.trim();
  if (!v) return { ok: false, reason: "empty" };
  if (!/^[\x20-\x7E]+$/.test(v)) return { ok: false, reason: "chars" };
  if (v.length > MAX_BARCODE_LENGTH) return { ok: false, reason: "tooLong" };
  return { ok: true, value: v };
}

/** The barcode a Product Code would give, or null when the code is not a valid barcode (non-ASCII, too long…). */
export function barcodeFromProductCode(code: string): string | null {
  const c = normalizeBarcode(code);
  return c.ok ? c.value : null;
}

/** Case-insensitive comparison, the same way the database compares barcodes. */
export const sameBarcode = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
