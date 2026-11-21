import { z } from "zod";
import { isCountryCode } from "@/lib/countries";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n";

// Shared Customer rules (Server Actions validate with this; safe to import on the client).

/** Today's local date as YYYY-MM-DD (the latest allowed date of birth). */
export function todayLocalIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isRealDate(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && d.getUTCFullYear() >= 1900;
}

/** Customer schema with dictionary messages (English by default). */
export function makeCustomerSchema(m: Dictionary["customers"]["val"] = en.customers.val) {
  return z.object({
    name: z.string().trim().min(1, m.nameRequired).max(120, m.nameLong),
    email: z.string().trim().toLowerCase().min(1, m.emailRequired).max(191, m.emailLong).pipe(z.email(m.emailInvalid)),
    phoneNumber: z
      .string()
      .trim()
      .min(1, m.phoneRequired)
      .regex(/^[0-9+()\-.\s]{6,32}$/, m.phoneInvalid),
    countryCode: z.string().trim().refine(isCountryCode, m.countryRequired),
    city: z.string().trim().min(1, m.cityRequired).max(120, m.cityLong),
    address: z.string().trim().min(1, m.addressRequired).max(500, m.addressLong),
    /** Optional: "" (none) or a real YYYY-MM-DD date that isn't in the future. */
    dateOfBirth: z
      .string()
      .trim()
      .optional()
      .default("")
      .refine((v) => v === "" || isRealDate(v), m.dobInvalid)
      .refine((v) => v === "" || !isRealDate(v) || v <= todayLocalIso(), m.dobFuture),
  });
}
export const customerInputSchema = makeCustomerSchema();

export type CustomerInput = z.infer<typeof customerInputSchema>;
export type CustomerField = keyof CustomerInput;
/** Values for the create/edit form (plain strings; "" until filled). */
export type CustomerFormValues = Record<CustomerField, string>;

/** A customer as shown in the list (display values prepared on the server). */
export type CustomerRow = {
  id: string;
  name: string;
  email: string;
  phoneNumber: string;
  countryName: string;
  city: string;
  createdOn: string;
};
