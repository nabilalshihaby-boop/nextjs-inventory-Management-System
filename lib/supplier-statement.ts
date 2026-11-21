// Supplier Account Statement — shared view types and query rules (client + server).
//
// A supplier ledger built ONLY from real, immutable records:
// - Purchase          → Credit  (increases what is owed to the supplier) = its Grand Total
// - Purchase Return   → Debit   (reduces what is owed)                   = its Grand Total
// - Supplier Payment  → Debit   (reduces what is owed)                   = its Amount
// Running balance = opening balance (everything before From Date) + Σ credit − Σ debit, in
// chronological order (date, then the moment it was recorded). Each currency is its own ledger;
// amounts in different currencies are never added together.

export type StatementKind = "PURCHASE" | "RETURN" | "PAYMENT";
/** Design badge tones: payment success, purchase warning (return: info). */
export const STATEMENT_KIND_TONE: Record<StatementKind, string> = { PURCHASE: "warning", RETURN: "info", PAYMENT: "success" };

export type StatementRow = {
  key: string;
  date: string; // YYYY-MM-DD
  dateLabel: string;
  kind: StatementKind;
  reference: string;
  href: string;
  description: string;
  debit: string | null; // 2-dp
  credit: string | null; // 2-dp
  balance: string; // running balance after this row (2-dp, may be negative)
};

export type StatementCurrency = { id: string; code: string; symbol: string; right: boolean };

export type SupplierStatement = {
  supplier: { id: string; name: string };
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  currency: StatementCurrency | null;
  /** Currencies this supplier has records in (a selector is shown only when there are several). */
  currencies: StatementCurrency[];
  opening: string;
  totalPurchases: string;
  totalReturns: string;
  totalPaid: string;
  closing: string;
  rows: StatementRow[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date (YYYY-MM-DD, year ≥ 2000). */
export function isStatementDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && d.getUTCFullYear() >= 2000;
}

/** Same rules as statementRangeError, but returns a dictionary key (stmt.range*) so the message can be localized. */
export function statementRangeKey(from: string, to: string): "stmt.rangeBoth" | "stmt.rangeInvalid" | "stmt.rangeOrder" | null {
  if (!from || !to) return "stmt.rangeBoth";
  if (!isStatementDate(from) || !isStatementDate(to)) return "stmt.rangeInvalid";
  if (from > to) return "stmt.rangeOrder";
  return null;
}

/** Validation shared by the filter form and the server (which falls back to defaults on errors). */
export function statementRangeError(from: string, to: string): string | null {
  if (!from || !to) return "Select both dates";
  if (!isStatementDate(from) || !isStatementDate(to)) return "Enter valid dates";
  if (from > to) return "From Date must be before To Date";
  return null;
}
