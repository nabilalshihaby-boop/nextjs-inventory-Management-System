// CSV writing helpers (server-only). UTF-8 with BOM so Excel opens Arabic correctly; CRLF line endings;
// RFC 4180 quoting; spreadsheet formula-injection protection.

const BOM = "\uFEFF";
const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * Text that a spreadsheet could run as a formula (starts with = + - @, tab or CR) gets a leading
 * apostrophe so it is shown as text. Plain numbers (e.g. -5.000) are left alone: they are not formulas.
 */
export function neutralize(v: string): string {
  return /^[=+\-@\t\r]/.test(v) && !NUMERIC.test(v) ? `'${v}` : v;
}

export function csvCell(value: string | number | null | undefined): string {
  const s = neutralize(value === null || value === undefined ? "" : String(value));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows: (string | number | null | undefined)[][]): string => BOM + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/** An ASCII-safe file name stem ("Main Warehouse" → "Main-Warehouse"; Arabic-only names fall back to `fallback`). */
export function safeFileStem(name: string, fallback: string): string {
  const s = name.normalize("NFKD").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return s || fallback;
}

/** A download response: attachment, no caching, no sniffing. `utf8Name` (optional) is the full Unicode name. */
export function csvDownload(body: string, filename: string, utf8Name?: string): Response {
  const disp = `attachment; filename="${filename}"` + (utf8Name ? `; filename*=UTF-8''${encodeURIComponent(utf8Name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}` : "");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": disp,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const denied = (status: 401 | 403 | 404, message: string): Response =>
  new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
