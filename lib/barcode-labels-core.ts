// Barcode label sheets: pure definitions shared by the selection page and the label route (no server imports).
//
// The user chooses a PAPER first (A4 or US Letter) and then one of the label layouts made for that paper. A layout is a
// real, separately defined sheet geometry in millimetres: a Letter sheet is never scaled into A4 or the other way round.
//   US Letter (215.9 x 279.4 mm): the four layouts of design/Print Barcode.html (inch label stock, Avery 5160/5161/5162/5163 style).
//   A4 (210 x 297 mm): four metric layouts of the same label counts (Avery L7159/L7162/L7163/L7173 style).
// Sheets print 1:1 (the page has no margin; the sheet's own margins are part of the layout), so they line up with pre-cut
// label stock when the printer prints at 100%.

export const PAPER_IDS = ["A4", "LETTER"] as const;
export type PaperId = (typeof PAPER_IDS)[number];
/** Sheet size in millimetres; `key` indexes the dictionary (barcode.print.papers). */
export const PAPERS: Record<PaperId, { id: PaperId; key: "a4" | "letter"; w: number; h: number }> = {
  A4: { id: "A4", key: "a4", w: 210, h: 297 },
  LETTER: { id: "LETTER", key: "letter", w: 215.9, h: 279.4 },
};

export const LABEL_SIZE_IDS = ["30", "20", "14", "10", "a24", "a16", "a14", "a10"] as const;
export type LabelSizeId = (typeof LABEL_SIZE_IDS)[number];

export type LabelSize = {
  id: LabelSizeId;
  paper: PaperId;
  /** Dictionary key under barcode.print.sizes (the name includes the paper size and the labels per sheet). */
  key: "s30" | "s20" | "s14" | "s10" | "a24" | "a16" | "a14" | "a10";
  cols: number;
  rows: number;
  /** Label width/height, sheet margins and the horizontal gap between columns, all in millimetres. */
  w: number;
  h: number;
  top: number;
  left: number;
  gapX: number;
};

const inch = (x: number) => Math.round(x * 25.4 * 1000) / 1000;

export const LABEL_SIZES: Record<LabelSizeId, LabelSize> = {
  // US Letter, inch label stock (the design's four sizes)
  "30": { id: "30", paper: "LETTER", key: "s30", cols: 3, rows: 10, w: inch(2.625), h: inch(1), top: inch(0.5), left: inch(0.1875), gapX: inch(0.125) },
  "20": { id: "20", paper: "LETTER", key: "s20", cols: 2, rows: 10, w: inch(4), h: inch(1), top: inch(0.5), left: inch(0.15625), gapX: inch(0.1875) },
  "14": { id: "14", paper: "LETTER", key: "s14", cols: 2, rows: 7, w: inch(4), h: inch(1.33), top: inch(0.83), left: inch(0.15625), gapX: inch(0.1875) },
  "10": { id: "10", paper: "LETTER", key: "s10", cols: 2, rows: 5, w: inch(4), h: inch(2), top: inch(0.5), left: inch(0.15625), gapX: inch(0.1875) },
  // A4, metric label stock
  a24: { id: "a24", paper: "A4", key: "a24", cols: 3, rows: 8, w: 70, h: 37, top: 0.5, left: 0, gapX: 0 },
  a16: { id: "a16", paper: "A4", key: "a16", cols: 2, rows: 8, w: 99.1, h: 33.9, top: 12.9, left: 4.65, gapX: 2.5 },
  a14: { id: "a14", paper: "A4", key: "a14", cols: 2, rows: 7, w: 99.1, h: 38.1, top: 15.1, left: 4.65, gapX: 2.5 },
  a10: { id: "a10", paper: "A4", key: "a10", cols: 2, rows: 5, w: 99.1, h: 57, top: 6, left: 4.65, gapX: 2.5 },
};
export const perSheet = (s: LabelSize) => s.cols * s.rows;
export const sizesFor = (paper: PaperId): LabelSize[] => LABEL_SIZE_IDS.map((id) => LABEL_SIZES[id]).filter((s) => s.paper === paper);
/** Text size tier of a label from its height (drives font sizes and the barcode height in CSS). */
export const tierOf = (s: LabelSize): 1 | 2 | 3 => (s.h < 28 ? 1 : s.h < 45 ? 2 : 3);
/** The sheet's printable height: 0.5 mm shorter than the page, so a full sheet never spills onto an extra page. */
export const SHEET_TRIM_MM = 0.5;

// Server-enforced limits (also checked in the browser for instant feedback): a mistake can't queue a huge print job.
export const MAX_LABEL_ITEMS = 50;
export const MAX_LABELS_TOTAL = 500;
export const MAX_LABELS_PER_ITEM = 500;

export type LabelItem = { conversionId: string; qty: number };
export type LabelRequest = { items: LabelItem[]; paper: PaperId; size: LabelSizeId; company: boolean; name: boolean; price: boolean };
export type LabelRequestError = "errInvalid" | "errEmpty" | "errItems" | "errTotal" | "errQty" | "errSize" | "errPaper";

const flag = (v: unknown, dflt: boolean) => (v === "1" ? true : v === "0" ? false : dflt);

/**
 * Parse the label request from URL parameters: items="<conversionId>:<qty>,…", paper (A4|LETTER), size (a layout of that
 * paper), co/pn/pr = 0|1. Nothing here is trusted beyond its shape: the server re-reads every unit, barcode and price.
 * The paper and layout must be chosen explicitly and must belong together.
 */
export function parseLabelRequest(sp: Record<string, string | string[] | undefined>): { ok: true; req: LabelRequest } | { ok: false; error: LabelRequestError } {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const raw = one("items");
  if (raw === undefined || raw === "") return { ok: false, error: "errEmpty" };
  if (raw.length > 4000) return { ok: false, error: "errInvalid" };
  const paper = one("paper");
  if (!paper || !(PAPER_IDS as readonly string[]).includes(paper)) return { ok: false, error: "errPaper" };
  const size = one("size");
  if (!size || !(LABEL_SIZE_IDS as readonly string[]).includes(size)) return { ok: false, error: "errSize" };
  if (LABEL_SIZES[size as LabelSizeId].paper !== paper) return { ok: false, error: "errSize" };
  const parts = raw.split(",");
  if (parts.length > MAX_LABEL_ITEMS) return { ok: false, error: "errItems" };
  const items: LabelItem[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const part of parts) {
    const m = /^([A-Za-z0-9_-]{1,40}):(\d{1,4})$/.exec(part);
    if (!m) return { ok: false, error: "errInvalid" };
    const qty = Number(m[2]);
    if (qty < 1 || qty > MAX_LABELS_PER_ITEM) return { ok: false, error: "errQty" };
    if (seen.has(m[1])) return { ok: false, error: "errInvalid" };
    seen.add(m[1]);
    total += qty;
    items.push({ conversionId: m[1], qty });
  }
  if (total > MAX_LABELS_TOTAL) return { ok: false, error: "errTotal" };
  return { ok: true, req: { items, paper: paper as PaperId, size: size as LabelSizeId, company: flag(one("co"), true), name: flag(one("pn"), true), price: flag(one("pr"), true) } };
}

/** The query string of the label preview route for a request (the selection page only builds this link). */
export function labelRequestQuery(r: LabelRequest): string {
  const sp = new URLSearchParams();
  sp.set("items", r.items.map((i) => `${i.conversionId}:${i.qty}`).join(","));
  sp.set("paper", r.paper);
  sp.set("size", r.size);
  sp.set("co", r.company ? "1" : "0");
  sp.set("pn", r.name ? "1" : "0");
  sp.set("pr", r.price ? "1" : "0");
  return sp.toString();
}
