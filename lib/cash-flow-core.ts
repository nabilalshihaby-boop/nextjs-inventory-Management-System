// Cash Flow (direct method) — the pure engine. No database, no I/O, no floating point: money is BigInt cents.
//
// The statement is built ONLY from persisted Cash & Bank ledger rows. A row is classified by its trusted SOURCE LINK
// (the foreign key the owning module wrote together with the row), never by free-text purpose or notes:
//   DEPOSIT   + customerPaymentId  -> Customer Collections          (operating inflow; POS tenders are customer payments too)
//   WITHDRAWAL+ supplierPaymentId  -> Supplier Payments             (operating outflow)
//   WITHDRAWAL+ expenseId          -> Operating Expenses            (operating outflow)
//   DEPOSIT   + expenseId          -> Expense Reversals             (reverses the expense outflow: edit / delete)
//   TRANSFER between two accounts of the report currency            -> INTERNAL (excluded; register Cash In/Out are transfers too)
//   anything else (manual deposits / withdrawals, legacy rows)      -> UNCLASSIFIED (never labelled operating/investing/financing)
// Closing = Opening + every external movement of the period; the engine also recomputes the closing balance independently
// from opening balances + all ledger rows up to the end date, and reports whether the two agree.

export type FlowType = "DEPOSIT" | "WITHDRAWAL" | "TRANSFER";
export type FlowTx = {
  id: string;
  /** AUTO_INCREMENT entry number: the same-day tie-break, exactly like the Cash & Bank transactions table. */
  number: number;
  /** Effective business day, YYYY-MM-DD (the ledger's own transactionDate). */
  date: string;
  reference: string;
  type: FlowType;
  accountId: string;
  destinationAccountId: string | null;
  /** Cents, always positive. */
  amount: bigint;
  purpose: string | null;
  notes: string | null;
  customerPaymentId: string | null;
  supplierPaymentId: string | null;
  expenseId: string | null;
  /** Set when the row is the ledger transfer of a POS register Cash In / Cash Out. */
  registerMovement: "CASH_IN" | "CASH_OUT" | null;
};
export type FlowAccount = { id: string; currencyId: string; /** Cents. */ opening: bigint };

export type FlowCategory =
  | "CUSTOMER_COLLECTION"
  | "SUPPLIER_PAYMENT"
  | "OPERATING_EXPENSE"
  | "EXPENSE_REVERSAL"
  | "UNCLASSIFIED_IN"
  | "UNCLASSIFIED_OUT"
  | "INTERNAL_TRANSFER"
  | "REGISTER_CASH_IN"
  | "REGISTER_CASH_OUT";

const ZERO = BigInt(0);

/** The consolidated effect of one row on the cash of ONE currency (cents; 0 for internal movements) and its category. null = not this currency. */
export function classify(tx: FlowTx, currencyOf: (accountId: string) => string | undefined, currencyId: string): { category: FlowCategory; effect: bigint; internal: boolean } | null {
  const src = currencyOf(tx.accountId) === currencyId;
  const dst = tx.destinationAccountId ? currencyOf(tx.destinationAccountId) === currencyId : false;
  if (tx.type === "TRANSFER") {
    if (src && dst) return { category: tx.registerMovement === "CASH_IN" ? "REGISTER_CASH_IN" : tx.registerMovement === "CASH_OUT" ? "REGISTER_CASH_OUT" : "INTERNAL_TRANSFER", effect: ZERO, internal: true };
    // A transfer to/from an account of ANOTHER currency is real money leaving/entering this currency's cash: never guessed, never converted.
    if (src) return { category: "UNCLASSIFIED_OUT", effect: -tx.amount, internal: false };
    if (dst) return { category: "UNCLASSIFIED_IN", effect: tx.amount, internal: false };
    return null;
  }
  if (!src) return null;
  if (tx.type === "DEPOSIT") {
    if (tx.customerPaymentId) return { category: "CUSTOMER_COLLECTION", effect: tx.amount, internal: false };
    if (tx.expenseId) return { category: "EXPENSE_REVERSAL", effect: tx.amount, internal: false };
    return { category: "UNCLASSIFIED_IN", effect: tx.amount, internal: false };
  }
  if (tx.supplierPaymentId) return { category: "SUPPLIER_PAYMENT", effect: -tx.amount, internal: false };
  if (tx.expenseId) return { category: "OPERATING_EXPENSE", effect: -tx.amount, internal: false };
  return { category: "UNCLASSIFIED_OUT", effect: -tx.amount, internal: false };
}

export const compareFlow = (a: FlowTx, b: FlowTx) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.number - b.number);

export type FlowRow = { tx: FlowTx; category: FlowCategory; internal: boolean; /** Signed external effect in cents (0 when internal). */ effect: bigint; /** Consolidated balance after this row (cents). */ balance: bigint };

export type CashFlowStatement = {
  opening: bigint;
  customerCollections: bigint;
  supplierPayments: bigint;
  operatingExpenses: bigint;
  expenseReversals: bigint;
  /** Customer collections − supplier payments − operating expenses + expense reversals. */
  operatingNet: bigint;
  unclassifiedIn: bigint;
  unclassifiedOut: bigint;
  unclassifiedNet: bigint;
  netChange: bigint;
  closing: bigint;
  /** Closing recomputed independently: Σ opening balances + every external ledger effect up to the end date. */
  closingCheck: bigint;
  reconciled: boolean;
  internal: { count: number; transfers: bigint; registerIn: bigint; registerOut: bigint };
  rows: FlowRow[];
};

export function buildCashFlow(input: { from: string; to: string; currencyId: string; accounts: FlowAccount[]; txs: FlowTx[] }): CashFlowStatement {
  const cur = new Map(input.accounts.map((a) => [a.id, a.currencyId]));
  const currencyOf = (id: string) => cur.get(id);
  const sorted = [...input.txs].sort(compareFlow);
  let opening = input.accounts.filter((a) => a.currencyId === input.currencyId).reduce((n, a) => n + a.opening, ZERO);
  let upToEnd = opening; // opening balances + every effect with date <= to
  const rows: FlowRow[] = [];
  const t = { cc: ZERO, sp: ZERO, oe: ZERO, er: ZERO, ui: ZERO, uo: ZERO, tr: ZERO, ri: ZERO, ro: ZERO, n: 0 };
  // pass 1: opening position (everything before From)
  for (const tx of sorted) {
    if (tx.date >= input.from) break;
    const c = classify(tx, currencyOf, input.currencyId);
    if (c) opening += c.effect;
  }
  let run = opening;
  for (const tx of sorted) {
    const c = classify(tx, currencyOf, input.currencyId);
    if (!c) continue;
    if (tx.date <= input.to) upToEnd += c.effect;
    if (tx.date < input.from || tx.date > input.to) continue;
    run += c.effect;
    rows.push({ tx, category: c.category, internal: c.internal, effect: c.effect, balance: run });
    switch (c.category) {
      case "CUSTOMER_COLLECTION": t.cc += tx.amount; break;
      case "SUPPLIER_PAYMENT": t.sp += tx.amount; break;
      case "OPERATING_EXPENSE": t.oe += tx.amount; break;
      case "EXPENSE_REVERSAL": t.er += tx.amount; break;
      case "UNCLASSIFIED_IN": t.ui += tx.amount; break;
      case "UNCLASSIFIED_OUT": t.uo += tx.amount; break;
      case "REGISTER_CASH_IN": t.ri += tx.amount; t.n++; break;
      case "REGISTER_CASH_OUT": t.ro += tx.amount; t.n++; break;
      case "INTERNAL_TRANSFER": t.tr += tx.amount; t.n++; break;
    }
  }
  const operatingNet = t.cc - t.sp - t.oe + t.er;
  const unclassifiedNet = t.ui - t.uo;
  const netChange = operatingNet + unclassifiedNet;
  const closing = opening + netChange;
  return {
    opening,
    customerCollections: t.cc,
    supplierPayments: t.sp,
    operatingExpenses: t.oe,
    expenseReversals: t.er,
    operatingNet,
    unclassifiedIn: t.ui,
    unclassifiedOut: t.uo,
    unclassifiedNet,
    netChange,
    closing,
    closingCheck: upToEnd,
    reconciled: closing === upToEnd && (rows.length === 0 ? true : rows[rows.length - 1].balance === closing),
    internal: { count: t.n, transfers: t.tr, registerIn: t.ri, registerOut: t.ro },
    rows,
  };
}
