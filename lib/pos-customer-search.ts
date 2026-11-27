// POS customer search: the rules shared by the server query and the screen (no database access here).
import { z } from "zod";

export const CUSTOMER_SEARCH_LIMIT = 20;
export const customerSearchSchema = z.strictObject({ q: z.string().max(100) });

export type CustomerPick = { id: string; name: string };
/** `hint` is masked contact context ("••• 4321" / "a•••@example.com"): enough to tell people apart, never the full value. */
export type CustomerHit = CustomerPick & { hint: string };
export type CustomerSearchResponse = { customers: CustomerHit[]; more: boolean };

/** Characters ignored when matching: Arabic diacritics and tatweel, zero-width and direction marks. */
export const IGNORED_MARKS = "ً-ٰٟـ​-‏؜";
/** Arabic spellings people type interchangeably: alef forms, alef maqsura / ya, ta marbuta / ha. */
export const LETTER_FOLDS: readonly (readonly [string, string])[] = [["أ", "ا"], ["إ", "ا"], ["آ", "ا"], ["ٱ", "ا"], ["ى", "ي"], ["ة", "ه"]];

export function normalizeSearch(value: string): string {
  let v = value
    .normalize("NFKC")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(new RegExp(`[${IGNORED_MARKS}]`, "g"), "")
    .toLowerCase();
  for (const [from, to] of LETTER_FOLDS) v = v.replaceAll(from, to);
  return v.replace(/\s+/g, " ").trim();
}

export function contactHint(phoneNumber: string, email: string): string {
  const digits = phoneNumber.replace(/\D/g, "");
  if (digits) return `••• ${digits.slice(-4)}`;
  const at = email.lastIndexOf("@");
  return at > 0 ? `${email[0]}•••${email.slice(at)}` : "";
}
