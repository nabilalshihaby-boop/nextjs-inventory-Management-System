// Receivables & Payables Aging — the pure engine. No database, no I/O, no floating point: money is BigInt cents.
//
// Policy (the application records no payment terms or due dates, so nothing here is "overdue"):
// - Every outstanding document is aged from its own document date (Sale date / Purchase date): "days since invoice date".
// - As of Date D: a document counts only if its date <= D. Its outstanding amount on D is
//       max(0, grand total − Σ returns dated <= D − Σ payment ALLOCATIONS whose payment is dated <= D)
//   so a return or payment recorded AFTER D never reduces a historical balance, and the invoice's current Due field is never used.
// - Only documents with a positive outstanding amount on D appear.
// - Buckets by whole days since the invoice date (deterministic at every boundary):
//       0–30 Current · 31–60 · 61–90 · 91 and over
// - Receivables and Payables are separate sections and are never netted.

export const BUCKETS = ["CURRENT", "D31_60", "D61_90", "OVER_90"] as const;
export type Bucket = (typeof BUCKETS)[number];

const ZERO = BigInt(0);

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD). UTC arithmetic, so DST never shifts a day. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86400000);
}

/** 0–30 → CURRENT, 31–60, 61–90, 91+ → OVER_90. (The invoice date itself is day 0.) */
export function bucketOf(days: number): Bucket {
  if (days <= 30) return "CURRENT";
  if (days <= 60) return "D31_60";
  if (days <= 90) return "D61_90";
  return "OVER_90";
}

export type AgingDoc = {
  id: string;
  partyId: string;
  partyName: string;
  reference: string;
  /** Document date, YYYY-MM-DD. */
  date: string;
  /** Free label of the document's status (purchases only). */
  status: string | null;
  /** Cents. */
  total: bigint;
  /** Σ completed returns dated on or before the As of Date (cents). */
  returns: bigint;
  /** Σ payment allocations of payments dated on or before the As of Date (cents). */
  payments: bigint;
};

export type AgingRow = AgingDoc & { days: number; bucket: Bucket; outstanding: bigint; /** The returns / payments actually applied (never more than the total). */ appliedReturns: bigint; appliedPayments: bigint };
export type Amounts = { total: bigint; returns: bigint; payments: bigint; outstanding: bigint; buckets: Record<Bucket, bigint> };
export type AgingGroup = { partyId: string; partyName: string; rows: AgingRow[]; sub: Amounts };
export type AgingSection = { groups: AgingGroup[]; totals: Amounts; /** True when Σ buckets === Σ outstanding === Σ(total − returns − payments) of the shown rows. */ reconciled: boolean };

const emptyAmounts = (): Amounts => ({ total: ZERO, returns: ZERO, payments: ZERO, outstanding: ZERO, buckets: { CURRENT: ZERO, D31_60: ZERO, D61_90: ZERO, OVER_90: ZERO } });
const add = (a: Amounts, r: AgingRow) => {
  a.total += r.total;
  a.returns += r.appliedReturns;
  a.payments += r.appliedPayments;
  a.outstanding += r.outstanding;
  a.buckets[r.bucket] += r.outstanding;
};

/** The aged rows of one section as of `asOf`. Documents dated after `asOf`, and documents with nothing outstanding, are left out. */
export function buildAging(docs: AgingDoc[], asOf: string): AgingSection {
  const byParty = new Map<string, AgingGroup>();
  const totals = emptyAmounts();
  let check = ZERO;
  for (const d of docs) {
    if (d.date > asOf) continue;
    const net = d.total - d.returns - d.payments;
    if (net <= ZERO) continue;
    const days = daysBetween(d.date, asOf);
    const row: AgingRow = { ...d, days, bucket: bucketOf(days), outstanding: net, appliedReturns: d.returns, appliedPayments: d.payments };
    const g = byParty.get(d.partyId) ?? { partyId: d.partyId, partyName: d.partyName, rows: [], sub: emptyAmounts() };
    g.rows.push(row);
    add(g.sub, row);
    byParty.set(d.partyId, g);
    add(totals, row);
    check += d.total - d.returns - d.payments;
  }
  const groups = [...byParty.values()].sort((a, b) => a.partyName.localeCompare(b.partyName) || a.partyId.localeCompare(b.partyId));
  for (const g of groups) g.rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.reference.localeCompare(b.reference)));
  const bucketSum = BUCKETS.reduce((n, b) => n + totals.buckets[b], ZERO);
  const groupSum = groups.reduce((n, g) => n + g.sub.outstanding, ZERO);
  return { groups, totals, reconciled: bucketSum === totals.outstanding && groupSum === totals.outstanding && check === totals.outstanding };
}
