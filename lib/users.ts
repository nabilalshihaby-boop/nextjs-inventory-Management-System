import { z } from "zod";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";

// Shared Users-management rules (Server Actions validate with this; safe to import on the client).

/** Roles the Owner can assign. OWNER is never assignable: the seeded Owner is the only one. */
export const ASSIGNABLE_ROLES = ["ADMIN", "USER"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const MIN_PASSWORD = 8;
const encoder = new TextEncoder();

/** Schemas with dictionary messages (English by default). */
export function makeUserSchemas(m: Dictionary["users"]["val"] = en.users.val) {
  const password = z
    .string()
    .min(MIN_PASSWORD, fmt(m.passwordMin, { min: MIN_PASSWORD }))
    // bcrypt only uses the first 72 bytes; refuse longer input instead of silently truncating it.
    .refine((v) => encoder.encode(v).length <= 72, m.passwordMax);

  const details = {
    firstName: z.string().trim().min(1, m.firstRequired).max(100, m.firstLong),
    lastName: z.string().trim().min(1, m.lastRequired).max(100, m.lastLong),
    email: z.string().trim().toLowerCase().min(1, m.emailRequired).max(191, m.emailLong).pipe(z.email(m.emailInvalid)),
    phoneNumber: z
      .string()
      .trim()
      .min(1, m.phoneRequired)
      .regex(/^[0-9+()\-.\s]{6,32}$/, m.phoneInvalid),
    role: z.enum(ASSIGNABLE_ROLES, { error: m.roleInvalid }),
  };

  /** Create: every field required, password confirmed. */
  const create = z
    .object({ ...details, password, confirmPassword: z.string().min(1, m.confirmRequired) })
    .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: m.mismatch });

  /** Edit: password optional; if given, it must be valid and confirmed. */
  const update = z
    .object({ ...details, password: z.string().optional().default(""), confirmPassword: z.string().optional().default("") })
    .superRefine((v, ctx) => {
      if (!v.password && !v.confirmPassword) return;
      const r = password.safeParse(v.password);
      if (!r.success) ctx.addIssue({ code: "custom", path: ["password"], message: r.error.issues[0].message });
      else if (v.password !== v.confirmPassword) ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: m.mismatch });
    });
  return { create, update };
}
const english = makeUserSchemas();
export const createUserSchema = english.create;
export const updateUserSchema = english.update;

export type UserField = "firstName" | "lastName" | "email" | "phoneNumber" | "password" | "confirmPassword" | "role" | "avatar" | "accessRoleId" | "warehouseIds";

/** Form values (never includes a password from the server — password fields always start empty). */
export type UserFormValues = { firstName: string; lastName: string; email: string; phoneNumber: string; role: string; image: string | null; accessRoleId?: string; warehouseIds?: string[] };

/** A user as shown in the list (no hash, no secrets). */
export type UserRow = {
  id: string;
  name: string;
  email: string;
  phoneNumber: string;
  role: "OWNER" | "ADMIN" | "USER";
  roleLabel: string;
  /** Display name of the operational role (USER only), or null. */
  accessRole?: string | null;
  image: string | null;
  initials: string;
  createdOn: string;
  isSelf: boolean;
};
