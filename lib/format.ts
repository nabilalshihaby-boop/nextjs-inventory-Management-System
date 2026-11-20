// Date/time display helpers (server-side), following the System Settings date format.

const pad = (n: number) => String(n).padStart(2, "0");

/** Format a date as the System Settings date format (DD/MM/YYYY, MM/DD/YYYY or YYYY-MM-DD). */
export function formatDate(d: Date, dateFormat: string | null | undefined): string {
  const dd = pad(d.getDate()), mm = pad(d.getMonth() + 1), yyyy = String(d.getFullYear());
  switch (dateFormat) {
    case "MM/DD/YYYY":
      return `${mm}/${dd}/${yyyy}`;
    case "YYYY-MM-DD":
      return `${yyyy}-${mm}-${dd}`;
    default:
      return `${dd}/${mm}/${yyyy}`;
  }
}

/** A date-only value (MySQL DATE → UTC midnight) in the System Settings format, without timezone shift. */
export function formatDateOnly(d: Date, dateFormat: string | null | undefined): string {
  return formatDate(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), dateFormat);
}

/** "11:52 AM · 04/11/2023" — the design's Created On style. */
export function formatDateTime(d: Date, dateFormat: string | null | undefined): string {
  const h = d.getHours();
  const time = `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? "AM" : "PM"}`;
  return `${time} · ${formatDate(d, dateFormat)}`;
}
