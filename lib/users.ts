import { z } from "zod";

// Shared Users-management rules (Server Actions validate with this; safe to import on the client).

/** Roles the Owner can assign. OWNER is never assignable: the seeded Owner is the only one. */
export const ASSIGNABLE_ROLES = ["ADMIN", "USER"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const MIN_PASSWORD = 8;
const encoder = new TextEncoder();

const password = z
  .string()
  .min(MIN_PASSWORD, `Password must be at least ${MIN_PASSWORD} characters`)
  // bcrypt only uses the first 72 bytes; refuse longer input instead of silently truncating it.
  .refine((v) => encoder.encode(v).length <= 72, "Password must be at most 72 bytes");

const details = {
  firstName: z.string().trim().min(1, "First name is required").max(100, "First name is too long"),
  lastName: z.string().trim().min(1, "Last name is required").max(100, "Last name is too long"),
  email: z.string().trim().toLowerCase().min(1, "Email is required").max(191, "Email is too long").pipe(z.email("Enter a valid email")),
  phoneNumber: z
    .string()
    .trim()
    .min(1, "Phone number is required")
    .regex(/^[0-9+()\-.\s]{6,32}$/, "Enter a valid phone number"),
  role: z.enum(ASSIGNABLE_ROLES, { error: "Choose a role (Administrator or User)" }),
};

/** Create: every field required, password confirmed. */
export const createUserSchema = z
  .object({ ...details, password, confirmPassword: z.string().min(1, "Confirm the password") })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

/** Edit: password optional; if given, it must be valid and confirmed. */
export const updateUserSchema = z
  .object({ ...details, password: z.string().optional().default(""), confirmPassword: z.string().optional().default("") })
  .superRefine((v, ctx) => {
    if (!v.password && !v.confirmPassword) return;
    const r = password.safeParse(v.password);
    if (!r.success) ctx.addIssue({ code: "custom", path: ["password"], message: r.error.issues[0].message });
    else if (v.password !== v.confirmPassword) ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "Passwords do not match" });
  });

export type UserField = "firstName" | "lastName" | "email" | "phoneNumber" | "password" | "confirmPassword" | "role" | "avatar";

/** Form values (never includes a password from the server — password fields always start empty). */
export type UserFormValues = { firstName: string; lastName: string; email: string; phoneNumber: string; role: string; image: string | null };

/** A user as shown in the list (no hash, no secrets). */
export type UserRow = {
  id: string;
  name: string;
  email: string;
  phoneNumber: string;
  role: "OWNER" | "ADMIN" | "USER";
  roleLabel: string;
  image: string | null;
  initials: string;
  createdOn: string;
  isSelf: boolean;
};
