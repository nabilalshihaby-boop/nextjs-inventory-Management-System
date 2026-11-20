import { z } from "zod";
import { isCountryCode } from "@/lib/countries";

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

export const customerInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name is too long"),
  email: z.string().trim().toLowerCase().min(1, "Email is required").max(191, "Email is too long").pipe(z.email("Enter a valid email")),
  phoneNumber: z
    .string()
    .trim()
    .min(1, "Phone number is required")
    .regex(/^[0-9+()\-.\s]{6,32}$/, "Enter a valid phone number"),
  countryCode: z.string().trim().refine(isCountryCode, "Country is required"),
  city: z.string().trim().min(1, "City is required").max(120, "City is too long"),
  address: z.string().trim().min(1, "Address is required").max(500, "Address is too long"),
  /** Optional: "" (none) or a real YYYY-MM-DD date that isn't in the future. */
  dateOfBirth: z
    .string()
    .trim()
    .optional()
    .default("")
    .refine((v) => v === "" || isRealDate(v), "Enter a valid date of birth")
    .refine((v) => v === "" || !isRealDate(v) || v <= todayLocalIso(), "Date of birth can't be in the future"),
});

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
