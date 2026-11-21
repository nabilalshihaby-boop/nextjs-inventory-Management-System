// Validation for Arabic override input. Pure (no server imports) so it is easy to test.
import { z } from "zod";
import { CATALOG_BY_KEY, placeholdersOf, samePlaceholders } from "@/lib/i18n/catalog";

export const MAX_TEXT = 500;
const keySchema = z.string().trim().min(1).max(120);

// Strict: only these fields are accepted. English/default/section/updatedBy sent by a client are "unrecognized keys".
export const saveSchema = z.strictObject({ locale: z.literal("ar"), key: keySchema, text: z.string() });
export const resetSchema = z.strictObject({ locale: z.literal("ar"), key: keySchema });

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/;
const SCRIPTY = /<|>|javascript\s*:|data\s*:\s*text\/html|&#|&lt;|&gt;|\bon\w+\s*=/i;

export type TextCheck =
  | { ok: true; text: string }
  | { ok: false; code: "textRequired" | "textTooLong" | "plainTextOnly" | "placeholderMismatch"; list?: string };

/** Trim and validate override text against the catalog entry's placeholder set. */
export function checkText(raw: string, key: string): TextCheck {
  const text = raw.trim();
  if (!text) return { ok: false, code: "textRequired" };
  if (text.length > MAX_TEXT) return { ok: false, code: "textTooLong" };
  if (CONTROL.test(text) || SCRIPTY.test(text)) return { ok: false, code: "plainTextOnly" };
  const want = CATALOG_BY_KEY.get(key)?.placeholders ?? [];
  if (!samePlaceholders(want, placeholdersOf(text))) return { ok: false, code: "placeholderMismatch", list: want.join(" ") || "—" };
  return { ok: true, text };
}

/** Fixed, timezone-stable "YYYY-MM-DD HH:mm UTC" label (identical on server and client). */
export const stamp = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
