// Customer Account Statement — shared view types (client + server).
//
// A receivable ledger built ONLY from real, immutable records:
// - Completed Sale     → Debit  (increases what the customer owes) = its Grand Total
// - Sale Return        → Credit (reduces what the customer owes)   = its Grand Total
// - Customer Payment   → Credit (reduces what the customer owes)   = its Amount
// Running balance = opening balance (everything before From Date) + Σ debit − Σ credit, in
// chronological order (date, then the moment it was recorded). Each currency is its own ledger.
import type { StatementCurrency } from "@/lib/supplier-statement";

export { isStatementDate, statementRangeError } from "@/lib/supplier-statement";
export type { StatementCurrency };

export type CustomerStatementKind = "SALE" | "RETURN" | "PAYMENT";
export const CUSTOMER_KIND_LABEL: Record<CustomerStatementKind, string> = { SALE: "Sale", RETURN: "Sales Return", PAYMENT: "Payment" };
/** Design badge tones: Sale warning, Payment success, Return info. */
export const CUSTOMER_KIND_TONE: Record<CustomerStatementKind, string> = { SALE: "warning", RETURN: "info", PAYMENT: "success" };

export type CustomerStatementRow = {
  key: string;
  date: string; // YYYY-MM-DD
  dateLabel: string;
  kind: CustomerStatementKind;
  reference: string;
  href: string;
  description: string;
  debit: string | null; // 2-dp
  credit: string | null; // 2-dp
  balance: string; // running balance after this row (2-dp, may be negative)
};

export type CustomerStatement = {
  /** null until a (valid) customer is selected. */
  customer: { id: string; name: string } | null;
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  currency: StatementCurrency | null;
  /** Currencies this customer has records in (a selector is shown only when there are several). */
  currencies: StatementCurrency[];
  opening: string;
  totalSales: string;
  totalReturns: string;
  totalPaid: string;
  closing: string;
  rows: CustomerStatementRow[];
};
