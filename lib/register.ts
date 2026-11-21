import { z } from "zod";
import { denominationCountsSchema } from "@/lib/denominations";

// POS register sessions (client + server). The browser sends ONLY ids, the counted amounts and notes.
// Status, expected cash, difference, the user and the account type are all decided on the server.

const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/; // DECIMAL(14,2); zero is allowed (an empty drawer)
const amount = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .refine((v) => MONEY_RE.test(v), `${label} must be a number with up to 2 decimal places (not negative)`);
const id = (msg: string) => z.string({ error: msg }).trim().min(1, msg).max(64, msg);

export const openRegisterSchema = z
  .object({
    cashBankAccountId: id("Choose a cash account"),
    openingCash: amount("Opening cash"),
    notes: z.string().trim().max(1000, "Notes are too long").optional().default(""),
  })
  .strict();

/**
 * Close Register: EITHER the typed counted cash (no denominations configured for the currency) OR integer
 * denomination counts (the server then computes the actual cash from the real denomination values and
 * ignores/rejects any client total). Never both.
 */
export const closeRegisterSchema = z
  .object({
    sessionId: id("Register session not found"),
    closingCash: amount("Counted cash").optional(),
    counts: denominationCountsSchema.optional(),
    notes: z.string().trim().max(1000, "Notes are too long").optional().default(""),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.closingCash !== undefined && v.counts !== undefined) ctx.addIssue({ code: "custom", path: ["counts"], message: "Send either the counted cash or the denomination counts, not both" });
  });

export const REGISTER_MOVEMENT_TYPES = ["CASH_IN", "CASH_OUT"] as const;
export type RegisterMovementType = (typeof REGISTER_MOVEMENT_TYPES)[number];
export const MOVEMENT_LABEL: Record<RegisterMovementType, string> = { CASH_IN: "Cash In", CASH_OUT: "Cash Out" };
export const formatMovementReference = (n: number) => `RM_${String(n).padStart(6, "0")}`;

/** Cash In / Cash Out: only ids, the amount and the reason. The date/time, status, balances, user and reference are server-owned. */
export const registerMovementSchema = z
  .object({
    sessionId: id("Register session not found"),
    type: z.enum(REGISTER_MOVEMENT_TYPES, { error: "Choose Cash In or Cash Out" }),
    counterAccountId: id("Choose the other account"),
    amount: amount("Amount").refine((v) => !MONEY_RE.test(v) || /[1-9]/.test(v), "Amount must be greater than 0"),
    notes: z.string({ error: "A reason is required" }).trim().min(1, "A reason is required").max(500, "The reason is too long"),
  })
  .strict();

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
