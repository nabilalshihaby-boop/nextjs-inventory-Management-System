import { z } from "zod";

// Cashier PIN rules (client + server). A PIN only unlocks the POS screen of an already signed-in session.
// The plain PIN is only ever held in memory while it is typed and hashed (bcrypt) on the server.

const DIGITS = /^\d{4,8}$/;

/** True for 1111, 12345, 98765 ... : all digits equal, or every step is +1 (ascending) or -1 (descending). */
export function isWeakPin(pin: string): boolean {
  if (!/^\d+$/.test(pin) || pin.length < 2) return true;
  const d = [...pin].map(Number);
  const steps = d.slice(1).map((x, i) => x - d[i]);
  return steps.every((s) => s === 0) || steps.every((s) => s === 1) || steps.every((s) => s === -1);
}

export const pinValue = z
  .string({ error: "PIN is required" })
  .refine((v) => DIGITS.test(v), "The PIN must be 4 to 8 digits (numbers only)")
  .refine((v) => !DIGITS.test(v) || !isWeakPin(v), "That PIN is too easy to guess (no repeated or sequential digits like 1111 or 1234)");

export const setPinSchema = z
  .object({
    currentPassword: z.string({ error: "Current password is required" }).min(1, "Current password is required").max(200),
    pin: pinValue,
    confirmPin: z.string({ error: "Confirm the PIN" }).min(1, "Confirm the PIN"),
  })
  .strict()
  .refine((v) => v.pin === v.confirmPin, { path: ["confirmPin"], message: "The PINs do not match" });

export const clearPinSchema = z.object({ currentPassword: z.string({ error: "Current password is required" }).min(1, "Current password is required").max(200) }).strict();

/** Unlock payloads: no user id, role, email or hash is ever accepted from the client. */
export const unlockPinSchema = z.object({ pin: z.string().min(1).max(32) }).strict();
