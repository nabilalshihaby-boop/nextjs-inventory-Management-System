"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { deleteImage, saveImage, validateImage, type ValidImage } from "@/lib/image-upload";
import { canManageUsers } from "@/lib/roles";
import { createUserSchema, updateUserSchema, type UserField } from "@/lib/users";

// Users management (OWNER only). Security rules enforced here, server-side:
// - auth() is re-read in every action; only the OWNER may proceed (the role is never taken from
//   the client, and the session itself is re-validated against MySQL in auth.ts).
// - OWNER can never be assigned (role ∈ ADMIN | USER), the Owner account can't be edited,
//   demoted or deleted here, and the Owner can't delete their own account.
// - Passwords: ≥ 8 characters, confirmed, hashed with bcryptjs cost 12. Plain passwords are never
//   returned, logged, rendered or stored; hashes never leave the server.
// - Avatars: content-validated JPG/PNG/WebP ≤ 2 MB, random name under public/uploads/users,
//   relative path only. LOCAL DEVELOPMENT ONLY — see lib/image-upload.ts (production needs
//   persistent object storage).

export type UserResult = { ok: true; message: string } | { ok: false; message: string; fieldErrors?: Partial<Record<UserField, string>> };

const FOLDER = "users";
const BCRYPT_COST = 12;
const idSchema = z.string().trim().min(1).max(64);
const DUPLICATE = "This email is already used by another account";
const OWNER_LOCKED = "The Owner account can't be changed here. The Owner edits their own details in Profile and Change Password.";

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

async function authorize(): Promise<{ userId: string } | { error: UserResult }> {
  const session = await auth();
  if (!session?.user?.id) return { error: { ok: false, message: "Your session has expired. Please sign in again." } };
  if (!canManageUsers(session.user.role)) return { error: { ok: false, message: "Only the Owner can manage users." } };
  return { userId: session.user.id };
}

function collect(issues: z.core.$ZodIssue[]): UserResult {
  const fieldErrors: Partial<Record<UserField, string>> = {};
  for (const i of issues) fieldErrors[i.path[0] as UserField] ??= i.message;
  return { ok: false, message: Object.values(fieldErrors)[0] ?? "Please check the form", fieldErrors };
}

/** Optional avatar from the form (validated by content). */
async function readAvatar(fd: FormData): Promise<{ image: ValidImage | null } | { error: string }> {
  const file = fd.get("avatar");
  if (!(file instanceof File) || file.size === 0) return { image: null };
  const r = await validateImage(file);
  return "error" in r ? r : { image: r };
}

/** Remove an avatar file this app created (user uploads or self-service profile avatars). */
async function removeAvatarFile(p: string | null) {
  await deleteImage(FOLDER, p);
  await deleteImage("avatars", p);
}

export async function createUser(formData: FormData): Promise<UserResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  if (!(formData instanceof FormData)) return { ok: false, message: "Invalid request" };

  const parsed = createUserSchema.safeParse({
    firstName: str(formData, "firstName"),
    lastName: str(formData, "lastName"),
    email: str(formData, "email"),
    phoneNumber: str(formData, "phoneNumber"),
    password: str(formData, "password"),
    confirmPassword: str(formData, "confirmPassword"),
    role: str(formData, "role"), // "OWNER" (or anything else) fails here
  });
  if (!parsed.success) return collect(parsed.error.issues);
  const avatar = await readAvatar(formData);
  if ("error" in avatar) return { ok: false, message: avatar.error, fieldErrors: { avatar: avatar.error } };
  const d = parsed.data;
  if (await db.user.findUnique({ where: { email: d.email }, select: { id: true } })) return { ok: false, message: DUPLICATE, fieldErrors: { email: DUPLICATE } };

  const passwordHash = await bcrypt.hash(d.password, BCRYPT_COST);
  const image = avatar.image ? await saveImage(FOLDER, avatar.image) : null;
  try {
    await db.user.create({
      data: { firstName: d.firstName, lastName: d.lastName, email: d.email, phoneNumber: d.phoneNumber, role: d.role, passwordHash, image },
      select: { id: true }, // never read the hash back
    });
  } catch (e) {
    await removeAvatarFile(image);
    if (isUnique(e)) return { ok: false, message: DUPLICATE, fieldErrors: { email: DUPLICATE } };
    throw e;
  }
  revalidatePath("/users");
  return { ok: true, message: "User created" };
}

/**
 * Edit an ADMIN/USER account. Password fields are optional: empty keeps the existing hash; a new
 * password (confirmed) replaces it, so the old one stops working. The Owner account is locked.
 */
export async function updateUser(id: unknown, formData: FormData): Promise<UserResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  if (!(formData instanceof FormData)) return { ok: false, message: "Invalid request" };
  const uid = idSchema.safeParse(id);
  if (!uid.success) return { ok: false, message: "User not found" };

  const target = await db.user.findUnique({ where: { id: uid.data }, select: { id: true, role: true, image: true } });
  if (!target) return { ok: false, message: "User not found" };
  if (target.role === "OWNER" || target.id === a.userId) return { ok: false, message: OWNER_LOCKED };

  const parsed = updateUserSchema.safeParse({
    firstName: str(formData, "firstName"),
    lastName: str(formData, "lastName"),
    email: str(formData, "email"),
    phoneNumber: str(formData, "phoneNumber"),
    password: str(formData, "password"),
    confirmPassword: str(formData, "confirmPassword"),
    role: str(formData, "role"),
  });
  if (!parsed.success) return collect(parsed.error.issues);
  const avatar = await readAvatar(formData);
  if ("error" in avatar) return { ok: false, message: avatar.error, fieldErrors: { avatar: avatar.error } };
  const d = parsed.data;
  if (await db.user.findFirst({ where: { email: d.email, NOT: { id: target.id } }, select: { id: true } })) {
    return { ok: false, message: DUPLICATE, fieldErrors: { email: DUPLICATE } };
  }

  const removeAvatar = formData.get("removeAvatar") === "on";
  const newImage = avatar.image ? await saveImage(FOLDER, avatar.image) : undefined; // undefined = keep
  const image = newImage !== undefined ? newImage : removeAvatar ? null : undefined;
  try {
    await db.user.update({
      where: { id: target.id },
      data: {
        firstName: d.firstName,
        lastName: d.lastName,
        email: d.email,
        phoneNumber: d.phoneNumber,
        role: d.role,
        // A password reset also bumps sessionVersion in the same UPDATE (one transaction), so every
        // existing session of that user ends on its next request (auth.ts).
        ...(d.password ? { passwordHash: await bcrypt.hash(d.password, BCRYPT_COST), sessionVersion: { increment: 1 } } : {}),
        ...(image !== undefined ? { image } : {}),
      },
      select: { id: true },
    });
  } catch (e) {
    if (newImage) await removeAvatarFile(newImage);
    if (isUnique(e)) return { ok: false, message: DUPLICATE, fieldErrors: { email: DUPLICATE } };
    throw e;
  }
  if (image !== undefined && target.image !== image) await removeAvatarFile(target.image);
  revalidatePath("/users");
  return { ok: true, message: d.password ? "User updated and password changed — their existing sessions were signed out" : "User updated" };
}

/**
 * Business records that keep a user's id as their author. Deleting such a user would orphan the
 * history, so deletion is refused. Add new modules' createdById/userId counts here as they arrive.
 */
async function findUserReferences(userId: string): Promise<string[]> {
  const [entries, transfers, adjustments] = await Promise.all([
    db.productStockEntry.count({ where: { createdById: userId } }),
    db.stockTransfer.count({ where: { createdById: userId } }),
    db.stockAdjustment.count({ where: { createdById: userId } }),
  ]);
  const out: string[] = [];
  if (entries) out.push(`${entries} opening-stock entr${entries === 1 ? "y" : "ies"}`);
  if (transfers) out.push(`${transfers} transfer${transfers === 1 ? "" : "s"}`);
  if (adjustments) out.push(`${adjustments} stock adjustment${adjustments === 1 ? "" : "s"}`);
  return out;
}

export async function deleteUser(id: unknown): Promise<UserResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const uid = idSchema.safeParse(id);
  if (!uid.success) return { ok: false, message: "User not found" };

  const target = await db.user.findUnique({ where: { id: uid.data }, select: { id: true, role: true, image: true } });
  if (!target) return { ok: false, message: "User not found" };
  if (target.id === a.userId) return { ok: false, message: "You can't delete your own account." };
  if (target.role === "OWNER") return { ok: false, message: "The Owner account can't be deleted." };

  const refs = await findUserReferences(target.id);
  if (refs.length) {
    return { ok: false, message: `This user can't be deleted because they recorded ${refs.join(", ")}. Their history must be kept; change their role or password instead.` };
  }
  try {
    // Conditional on the role so a concurrent change can never delete an Owner.
    const r = await db.user.deleteMany({ where: { id: target.id, role: { in: ["ADMIN", "USER"] } } });
    if (r.count !== 1) return { ok: false, message: "User not found" };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") return { ok: false, message: "This user can't be deleted because other records still use it." };
    throw e;
  }
  await removeAvatarFile(target.image);
  revalidatePath("/users");
  // Their existing session ends on its next request: auth.ts re-checks the account in MySQL.
  return { ok: true, message: "User deleted" };
}
