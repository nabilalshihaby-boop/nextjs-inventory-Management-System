// Code 128 encoder (subset B: every printable ASCII character, one symbol per character). Pure and dependency-free,
// so labels render as crisp local SVG — no external service, font or script. Subset B only (no subset C
// compression of digit pairs): always valid and universally scannable, a little wider for long numeric codes.
//
// A symbol is 11 modules wide (3 bars + 3 spaces, widths 1–4); the stop symbol is 13. Layout:
//   quiet zone (10 modules) · START B · data… · check symbol · STOP · quiet zone (10 modules)

// Bar/space widths of symbols 0–105 (value = character code − 32 in subset B), then START A/B/C (103–105) are inside it.
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232",
] as const;
const STOP = "2331112";
const START_B = 104;
const QUIET = 10;

export type Code128 = {
  /** Total width in modules, including both quiet zones. */
  modules: number;
  /** The bars as [x, width] in modules (x counted from the left edge of the quiet zone). */
  bars: [number, number][];
  /** The symbol values encoded (start, data…, check) — exposed for tests. */
  values: number[];
};

/** Encode printable ASCII text; returns null when the text is empty or contains anything else. */
export function encodeCode128(text: string): Code128 | null {
  if (!text || !/^[\x20-\x7E]+$/.test(text)) return null;
  const data = [...text].map((c) => c.charCodeAt(0) - 32);
  let sum = START_B;
  data.forEach((v, i) => (sum += v * (i + 1)));
  const values = [START_B, ...data, sum % 103];
  const widths: number[] = [];
  for (const v of values) for (const ch of PATTERNS[v]) widths.push(Number(ch));
  for (const ch of STOP) widths.push(Number(ch));
  const bars: [number, number][] = [];
  let x = QUIET;
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push([x, w]); // even positions are bars, odd are spaces
    x += w;
  });
  return { modules: x + QUIET, bars, values };
}

/** The SVG path of the bars (one rectangle per bar, height 1 — scaled by the viewBox), for a crisp vector symbol. */
export function code128Path(c: Code128): string {
  return c.bars.map(([x, w]) => `M${x} 0h${w}v1h${-w}z`).join("");
}

/** The pattern table is self-checked in tests: every symbol is 11 modules wide. */
export const __patterns = PATTERNS;
