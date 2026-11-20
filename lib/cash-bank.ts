import { z } from "zod";

// Shared Cash & Bank rules (client + server). Money is a 2-dp decimal string end-to-end (stored as
// DECIMAL(14,2)); arithmetic on the client uses scaled BigInt (lib/transfers.ts), never floats.

export const ACCOUNT_TYPES = ["CASH", "BANK"] as const;
export const ACCOUNT_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type AccountTypeValue = (typeof ACCOUNT_TYPES)[number];
export type AccountStatusValue = (typeof ACCOUNT_STATUSES)[number];
export const ACCOUNT_TYPE_LABEL: Record<AccountTypeValue, string> = { CASH: "Cash", BANK: "Bank" };
export const ACCOUNT_STATUS_LABEL: Record<AccountStatusValue, string> = { ACTIVE: "Active", INACTIVE: "Inactive" };

export const TX_TYPES = ["DEPOSIT", "WITHDRAWAL", "TRANSFER"] as const;
export type TxTypeValue = (typeof TX_TYPES)[number];
export const TX_LABEL: Record<TxTypeValue, string> = { DEPOSIT: "Deposit", WITHDRAWAL: "Withdrawal", TRANSFER: "Transfer" };
/** Design badge tones: deposit success, withdrawal danger, transfer info. */
export const TX_TONE: Record<TxTypeValue, string> = { DEPOSIT: "success", WITHDRAWAL: "danger", TRANSFER: "info" };
export const TX_PREFIX: Record<TxTypeValue, string> = { DEPOSIT: "DEP", WITHDRAWAL: "WDR", TRANSFER: "TRF" };
/** "DEP_000001" — from the AUTO_INCREMENT number (shared across types: gaps per type are expected). */
export const formatTxReference = (type: TxTypeValue, n: number) => `${TX_PREFIX[type]}_${String(n).padStart(6, "0")}`;

export const PAYMENT_METHODS = ["Cash", "Bank Transfer", "Card", "Cheque"] as const;

/**
 * Deposit sources / withdrawal purposes from the design. Only generic manual ones are allowed now;
 * the others need modules that don't exist yet and are shown disabled with this explanation.
 */
export const DEPOSIT_SOURCES = ["Other Income", "Opening Adjustment", "Other"] as const;
export const WITHDRAWAL_PURPOSES = ["Petty Cash", "Other"] as const;
export const DEFERRED_DEPOSIT_SOURCES = [
  { label: "Customer Collection", reason: "Recorded from Customer Payments" },
  { label: "POS Sales", reason: "Available after Sales are built" },
] as const;
export const DEFERRED_WITHDRAWAL_PURPOSES = [
  { label: "Supplier Payment", reason: "Recorded from Supplier Payments" },
  { label: "Operating Expense", reason: "Recorded from the Expenses module" },
] as const;

// ---- validation -------------------------------------------------------------------------------

const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/; // DECIMAL(14,2)
const money = (label: string, opts: { positive: boolean }) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .refine((v) => MONEY_RE.test(v), `${label} must be a number with up to 2 decimal places`)
    .refine((v) => !MONEY_RE.test(v) || !opts.positive || /[1-9]/.test(v), `${label} must be greater than 0`);

const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);
const optText = (max: number, label: string) => z.string().trim().max(max, `${label} is too long`).optional().default("");

/** Today's local date (YYYY-MM-DD); transactions can't be dated in the future. */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isRealDate(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && d.getUTCFullYear() >= 2000;
}
const txDate = z
  .string({ error: "Date is required" })
  .trim()
  .min(1, "Date is required")
  .refine(isRealDate, "Enter a valid date")
  .refine((v) => !isRealDate(v) || v <= todayLocal(), "The date can't be in the future");

/** Shared with Expenses: a valid, non-future date and positive 2-dp money (same rules as the ledger). */
export const transactionDateSchema = txDate;
export const positiveMoneySchema = (label: string) => money(label, { positive: true });

const accountFields = {
  name: z.string().trim().min(1, "Account name is required").max(120, "Account name is too long"),
  type: z.enum(ACCOUNT_TYPES, { error: "Choose Cash or Bank" }),
  reference: optText(64, "Reference"),
  bankName: optText(120, "Bank name"),
  status: z.enum(ACCOUNT_STATUSES, { error: "Choose a status" }),
  notes: optText(2000, "Notes"),
};
function bankRules(v: { type: AccountTypeValue; reference: string; bankName: string }, ctx: z.RefinementCtx) {
  if (v.type !== "BANK") return;
  if (!v.bankName) ctx.addIssue({ code: "custom", path: ["bankName"], message: "Bank name is required" });
  if (!v.reference) ctx.addIssue({ code: "custom", path: ["reference"], message: "Account number is required for bank accounts" });
}

/** Create: opening balance (≥ 0) is entered only here. Currency is never accepted from the client. */
export const accountCreateSchema = z.object({ ...accountFields, openingBalance: money("Opening balance", { positive: false }) }).superRefine(bankRules);
/** Edit: no balance of any kind (opening balance is fixed; current balance is always computed). */
export const accountUpdateSchema = z.object(accountFields).superRefine(bankRules);

export const depositSchema = z.object({
  transactionDate: txDate,
  accountId: id("Account is required"),
  amount: money("Amount", { positive: true }),
  paymentMethod: z.enum(PAYMENT_METHODS, { error: "Choose a payment method" }),
  purpose: z.enum(DEPOSIT_SOURCES, { error: "Choose an available deposit source" }),
  notes: optText(2000, "Notes"),
});
export const withdrawalSchema = depositSchema.extend({ purpose: z.enum(WITHDRAWAL_PURPOSES, { error: "Choose an available withdrawal purpose" }) });
export const transferSchema = z
  .object({
    transactionDate: txDate,
    fromAccountId: id("Choose the source account"),
    toAccountId: id("Choose the destination account"),
    amount: money("Amount", { positive: true }),
    notes: optText(2000, "Notes"),
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, { path: ["toAccountId"], message: "Source and destination must differ" });

export type AccountField = "name" | "type" | "reference" | "bankName" | "openingBalance" | "status" | "notes" | "currency";
export type TxField = "transactionDate" | "accountId" | "fromAccountId" | "toAccountId" | "amount" | "paymentMethod" | "purpose" | "notes";

// ---- view models ------------------------------------------------------------------------------

export type CurrencyView = { code: string; symbol: string; name: string; right: boolean };

export type AccountRow = {
  id: string;
  name: string;
  type: AccountTypeValue;
  reference: string;
  bankName: string;
  status: AccountStatusValue;
  notes: string;
  /** Computed current balance (2-dp string) and the account's own currency. */
  balance: string;
  openingBalance: string;
  currency: CurrencyView;
  /** In the System Settings default currency (KPI totals only add these). */
  inDefaultCurrency: boolean;
  recent: { date: string; description: string; reference: string; direction: "in" | "out"; amount: string }[];
};

export type TxRow = {
  id: string;
  number: number;
  reference: string;
  date: string; // YYYY-MM-DD (filters)
  when: string; // display "date · time"
  type: TxTypeValue;
  accountId: string;
  accountName: string;
  toAccountId: string | null;
  toAccountName: string | null;
  description: string;
  amount: string;
  moneyIn: string | null; // deposits only (transfers are internal)
  moneyOut: string | null; // withdrawals only
  balanceAfter: string; // source account's running balance after this row
  toBalanceAfter: string | null;
  paymentMethod: string;
  purpose: string;
  notes: string;
  currency: CurrencyView;
};

export type AccountOption = { id: string; name: string; type: AccountTypeValue; active: boolean; balance: string; currencyId: string; currency: CurrencyView };
