import { z } from "zod";
import { isCountryCode } from "@/lib/countries";

// Shared Supplier rules (Server Actions validate with this; safe to import on the client).

export const supplierInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name is too long"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email is required")
    .max(191, "Email is too long")
    .pipe(z.email("Enter a valid email")),
  phoneNumber: z
    .string()
    .trim()
    .min(1, "Phone number is required")
    .regex(/^[0-9+()\-.\s]{6,32}$/, "Enter a valid phone number"),
  countryCode: z.string().trim().refine(isCountryCode, "Country is required"),
  city: z.string().trim().min(1, "City is required").max(120, "City is too long"),
  address: z.string().trim().min(1, "Address is required").max(255, "Address is too long"),
});

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
