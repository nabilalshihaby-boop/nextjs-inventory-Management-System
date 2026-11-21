import { z } from "zod";
import { makeDenominationSchemas } from "@/lib/denominations";
import { fmt } from "@/lib/i18n/config";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n";

// POS register sessions (client + server). The browser sends ONLY ids, the counted amounts and notes.
// Status, expected cash, difference, the user and the account type are all decided on the server.

export const REGISTER_MOVEMENT_TYPES = ["CASH_IN", "CASH_OUT"] as const;
export type RegisterMovementType = (typeof REGISTER_MOVEMENT_TYPES)[number];
export const MOVEMENT_LABEL: Record<RegisterMovementType, string> = { CASH_IN: "Cash In", CASH_OUT: "Cash Out" };
export const formatMovementReference = (n: number) => `RM_${String(n).padStart(6, "0")}`;

const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/; // DECIMAL(14,2); zero is allowed (an empty drawer)
const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);

/**
 * Register schemas with dictionary messages (English by default). The browser sends ONLY ids, the counted
 * amounts and notes. Status, expected cash, difference, the user and the account type are decided on the server.
 * Close Register: EITHER the typed counted cash (no denominations configured) OR integer denomination counts.
 * Cash In / Cash Out: only ids, the amount and the reason; date/time, status, balances, user and reference are server-owned.
 */
export function makeRegisterSchemas(m: Dictionary["register"]["val"] = en.register.val, d: Dictionary["denom"]["val"] = en.denom.val) {
  const amount = (label: string) =>
    z
      .string({ error: fmt(m.required, { label }) })
      .trim()
      .min(1, fmt(m.required, { label }))
      .refine((v) => MONEY_RE.test(v), fmt(m.amountFormat, { label }));
  const counts = makeDenominationSchemas(d).denominationCountsSchema;
  return {
    openRegisterSchema: z
      .object({
        cashBankAccountId: id(m.chooseCashAccount),
        openingCash: amount(m.labels.openingCash),
        notes: z.string().trim().max(1000, m.notesLong).optional().default(""),
      })
      .strict(),
    closeRegisterSchema: z
      .object({
        sessionId: id(m.sessionNotFound),
        closingCash: amount(m.labels.countedCash).optional(),
        counts: counts.optional(),
        notes: z.string().trim().max(1000, m.notesLong).optional().default(""),
      })
      .strict()
      .superRefine((v, ctx) => {
        if (v.closingCash !== undefined && v.counts !== undefined) ctx.addIssue({ code: "custom", path: ["counts"], message: m.bothSent });
      }),
    registerMovementSchema: z
      .object({
        sessionId: id(m.sessionNotFound),
        type: z.enum(REGISTER_MOVEMENT_TYPES, { error: m.chooseMovement }),
        counterAccountId: id(m.chooseOther),
        amount: amount(m.labels.amount).refine((v) => !MONEY_RE.test(v) || /[1-9]/.test(v), m.amountPositive),
        notes: z.string({ error: m.reasonRequired }).trim().min(1, m.reasonRequired).max(500, m.reasonLong),
      })
      .strict(),
  };
}
const english = makeRegisterSchemas();
export const openRegisterSchema = english.openRegisterSchema;
export const closeRegisterSchema = english.closeRegisterSchema;
export const registerMovementSchema = english.registerMovementSchema;

export const formatRegisterReference = (n: number) => `RS_${String(n).padStart(6, "0")}`;

// ---- view models ----
export type OpenRegister = {
  id: string;
  reference: string;
  accountId: string;
  accountName: string;
  openingCash: string;
  /** Σ POS CASH tenders linked to this session. */
  cashSales: string;
  cashIn: string;
  cashOut: string;
  /** openingCash + cashSales + cashIn - cashOut (a live preview; the final value is recomputed on the server at close). */
  expected: string;
  openedAt: string;
  openedBy: string;
};
export type RegisterHistoryRow = {
  id: string;
  reference: string;
  accountName: string;
  status: "OPEN" | "CLOSED";
  openedBy: string;
  openedAt: string;
  closedAt: string | null;
  openingCash: string;
  expected: string;
  actual: string | null;
  difference: string | null;
};
export type RegisterMovementRow = {
  id: string;
  reference: string;
  sessionId: string;
  sessionReference: string;
  type: RegisterMovementType;
  at: string;
  from: string;
  to: string;
  amount: string;
  notes: string;
  user: string;
  transferReference: string;
};
export type RegisterOverview = { open: OpenRegister[]; history: RegisterHistoryRow[]; movements: RegisterMovementRow[] };
