// Product lookup for every selector that finds a product by typing or scanning (Sales, Purchases, Quotations, Transfers, Adjustments,
// POS, Products list). Pure and shared by the browser and the server.
//
// What can be typed: part of the NAME, the SKU, or a stored BARCODE (any unit of the product). The result order is deterministic:
//   1. an EXACT stored barcode   (a scanner types the whole code)
//   2. an EXACT SKU
//   3. everything else that merely contains the text, in the list's own order (the sort is stable)
// A barcode can never equal any SKU (the identifier registry guarantees it), so 1 and 2 can never both match different products.
// The barcode is a lookup aid only; it is never the key that links a product to anything outside the application.

export type LookupItem = { code: string; name: string; /** Stored barcodes of the product's units (optional: items without any are found by name / SKU). */ barcodes?: readonly string[] };

const norm = (s: string) => s.trim().toLowerCase();

/** 0 = exact stored barcode, 1 = exact SKU, 2 = contains the text, -1 = no match. */
export function lookupRank(rawNeedle: string, p: LookupItem): 0 | 1 | 2 | -1 {
  const needle = norm(rawNeedle);
  if (!needle) return -1;
  if (p.barcodes?.some((b) => norm(b) === needle)) return 0;
  if (norm(p.code) === needle) return 1;
  return `${p.code} ${p.name} ${(p.barcodes ?? []).join(" ")}`.toLowerCase().includes(needle) ? 2 : -1;
}

/** The matches for the typed text, best rank first (stable), at most `limit`. */
export function searchProducts<T extends LookupItem>(items: readonly T[], rawNeedle: string, limit = 20): T[] {
  const ranked: { p: T; r: number; i: number }[] = [];
  items.forEach((p, i) => {
    const r = lookupRank(rawNeedle, p);
    if (r >= 0) ranked.push({ p, r, i });
  });
  return ranked.sort((a, b) => a.r - b.r || a.i - b.i).slice(0, limit).map((x) => x.p);
}

/** The product a scanned / fully typed value identifies: an exact barcode first, then an exact SKU; undefined when neither matches. */
export function pickExact<T extends LookupItem>(items: readonly T[], rawNeedle: string): T | undefined {
  return items.find((p) => lookupRank(rawNeedle, p) === 0) ?? items.find((p) => lookupRank(rawNeedle, p) === 1);
}
