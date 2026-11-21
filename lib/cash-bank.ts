import { z } from "zod";
import { fmt } from "@/lib/i18n/config";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n";

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
/** Date rule with overridable messages (localized modules pass dictionary text; the default is English). */
export const makeTxDate = (m: { required: string; invalid: string; future: string } = { required: "Date is required", invalid: "Enter a valid date", future: "The date can't be in the future" }) =>
  z
    .string({ error: m.required })
    .trim()
    .min(1, m.required)
    .refine(isRealDate, m.invalid)
    .refine((v) => !isRealDate(v) || v <= todayLocal(), m.future);
const txDate = makeTxDate();

/** Shared with Expenses: a valid, non-future date and positive 2-dp money (same rules as the ledger). */
export const transactionDateSchema = txDate;
export const positiveMoneySchema = (label: string) => money(label, { positive: true });
/** Positive 2-dp money with dictionary messages ({label} placeholders already resolved by the caller). */
export const positiveMoneyWith = (m: { required: string; format: string; positive: string }) =>
  z
    .string({ error: m.required })
    .trim()
    .min(1, m.required)
    .refine((v) => MONEY_RE.test(v), m.format)
    .refine((v) => !MONEY_RE.test(v) || /[1-9]/.test(v), m.positive);

type FinVal = Dictionary["finance"]["val"];
/** All Cash & Bank input schemas built with a message set (dictionary text; English by default). */
export function makeCashBankSchemas(m: FinVal = en.finance.val) {
  const money = (label: string, positive: boolean) => {
    const req = fmt(m.required, { label });
    const base = z.string({ error: req }).trim().min(1, req).refine((v) => MONEY_RE.test(v), fmt(m.money, { label }));
    return positive ? base.refine((v) => !MONEY_RE.test(v) || /[1-9]/.test(v), fmt(m.positive, { label })) : base;
  };
  const optional = (max: number, label: string) => z.string().trim().max(max, fmt(m.tooLong, { label })).optional().default("");
  const date = makeTxDate({ required: m.dateRequired, invalid: m.dateInvalid, future: m.dateFuture });
  const accountFields = {
    name: z.string().trim().min(1, m.nameRequired).max(120, m.nameLong),
    type: z.enum(ACCOUNT_TYPES, { error: m.chooseType }),
    reference: optional(64, m.labels.reference),
    bankName: optional(120, m.labels.bankName),
    status: z.enum(ACCOUNT_STATUSES, { error: m.chooseStatus }),
    notes: optional(2000, m.labels.notes),
  };
  const bankRules = (v: { type: AccountTypeValue; reference: string; bankName: string }, ctx: z.RefinementCtx) => {
    if (v.type !== "BANK") return;
    if (!v.bankName) ctx.addIssue({ code: "custom", path: ["bankName"], message: m.bankNameRequired });
    if (!v.reference) ctx.addIssue({ code: "custom", path: ["reference"], message: m.accountNumberRequired });
  };
  const depositSchema = z.object({
    transactionDate: date,
    accountId: id(m.accountRequired),
    amount: money(m.labels.amount, true),
    paymentMethod: z.enum(PAYMENT_METHODS, { error: m.chooseMethod }),
    purpose: z.enum(DEPOSIT_SOURCES, { error: m.chooseSource }),
    notes: optional(2000, m.labels.notes),
  });
  return {
    /** Create: opening balance (>= 0) is entered only here. Currency is never accepted from the client. */
    accountCreateSchema: z.object({ ...accountFields, openingBalance: money(m.labels.openingBalance, false) }).superRefine(bankRules),
    /** Edit: no balance of any kind (opening balance is fixed; current balance is always computed). */
    accountUpdateSchema: z.object(accountFields).superRefine(bankRules),
    depositSchema,
    withdrawalSchema: depositSchema.extend({ purpose: z.enum(WITHDRAWAL_PURPOSES, { error: m.choosePurpose }) }),
    transferSchema: z
      .object({
        transactionDate: date,
        fromAccountId: id(m.chooseFrom),
        toAccountId: id(m.chooseTo),
        amount: money(m.labels.amount, true),
        notes: optional(2000, m.labels.notes),
      })
      .refine((v) => v.fromAccountId !== v.toAccountId, { path: ["toAccountId"], message: m.differ }),
  };
}
const english = makeCashBankSchemas();
export const accountCreateSchema = english.accountCreateSchema;
export const accountUpdateSchema = english.accountUpdateSchema;
export const depositSchema = english.depositSchema;
export const withdrawalSchema = english.withdrawalSchema;
export const transferSchema = english.transferSchema;

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
