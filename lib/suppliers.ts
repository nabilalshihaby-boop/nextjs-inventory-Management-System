import { z } from "zod";
import { isCountryCode } from "@/lib/countries";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n";

// Shared Supplier rules (Server Actions validate with this; safe to import on the client).

/** Supplier schema with dictionary messages (English by default). */
export function makeSupplierSchema(m: Dictionary["suppliers"]["val"] = en.suppliers.val) {
  return z.object({
    name: z.string().trim().min(1, m.nameRequired).max(120, m.nameLong),
    email: z.string().trim().toLowerCase().min(1, m.emailRequired).max(191, m.emailLong).pipe(z.email(m.emailInvalid)),
    phoneNumber: z.string().trim().min(1, m.phoneRequired).regex(/^[0-9+()\-.\s]{6,32}$/, m.phoneInvalid),
    countryCode: z.string().trim().refine(isCountryCode, m.countryRequired),
    city: z.string().trim().min(1, m.cityRequired).max(120, m.cityLong),
    address: z.string().trim().min(1, m.addressRequired).max(255, m.addressLong),
  });
}
export const supplierInputSchema = makeSupplierSchema();

export type SupplierInput = z.infer<typeof supplierInputSchema>;
export type SupplierField = keyof SupplierInput;
/** Values for the create/edit form (plain strings; "" until filled). */
export type SupplierFormValues = Record<SupplierField, string>;

/** A supplier as shown in the list (display values prepared on the server). */
export type SupplierRow = {
  id: string;
  name: string;
  email: string;
  phoneNumber: string;
  countryName: string;
  city: string;
  createdOn: string;
};
