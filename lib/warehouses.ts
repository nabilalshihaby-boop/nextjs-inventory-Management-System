import { z } from "zod";
import { isCountryCode } from "@/lib/countries";

// Shared Warehouse rules (Server Actions validate with this; safe to import on the client).

export const warehouseInputSchema = z.object({
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
  zipCode: z.string().trim().max(20, "Zip code is too long"),
});

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
