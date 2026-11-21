import { z } from "zod";
import { isCountryCode } from "@/lib/countries";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n";

// Shared Warehouse rules (Server Actions validate with this; safe to import on the client).

/** Validation schema; messages are dictionary text (English by default). */
export function makeWarehouseSchema(m: Dictionary["warehouses"]["val"] = en.warehouses.val) {
  return z.object({
    name: z.string().trim().min(1, m.nameRequired).max(120, m.nameLong),
    email: z.string().trim().toLowerCase().min(1, m.emailRequired).max(191, m.emailLong).pipe(z.email(m.emailInvalid)),
    phoneNumber: z.string().trim().min(1, m.phoneRequired).regex(/^[0-9+()\-.\s]{6,32}$/, m.phoneInvalid),
    countryCode: z.string().trim().refine(isCountryCode, m.countryRequired),
    city: z.string().trim().min(1, m.cityRequired).max(120, m.cityLong),
    zipCode: z.string().trim().max(20, m.zipLong),
  });
}
export const warehouseInputSchema = makeWarehouseSchema();

export type WarehouseInput = z.infer<typeof warehouseInputSchema>;
export type WarehouseField = keyof WarehouseInput;

/** A warehouse as shown in the list / view modal (display values prepared on the server). */
export type WarehouseRow = {
  id: string;
  name: string;
  email: string;
  phoneNumber: string;
  countryCode: string;
  countryName: string;
  city: string;
  zipCode: string;
  createdOn: string;
};

/** Values for the create/edit form. */
export type WarehouseFormValues = {
  name: string;
  email: string;
  phoneNumber: string;
  countryCode: string;
  city: string;
  zipCode: string;
};
