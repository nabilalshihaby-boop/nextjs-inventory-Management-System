"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { deleteImage, saveImage, validateImage, type ValidImage } from "@/lib/image-upload";
import { canManageUsers } from "@/lib/roles";
import { AccessRejected, applyUserAccess } from "@/lib/access-assign";
import { makeUserSchemas, type UserField } from "@/lib/users";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";

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

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
/** Only these form fields exist; anything else (a forged permission list, role flag, user id …) is rejected outright. */
const ALLOWED_FIELDS = new Set(["firstName", "lastName", "email", "phoneNumber", "password", "confirmPassword", "role", "avatar", "removeAvatar", "accessRoleId", "warehouseIds"]);
const hasUnknownFields = (fd: FormData) => [...fd.keys()].some((k) => !ALLOWED_FIELDS.has(k));
const accessOf = (fd: FormData, role: "ADMIN" | "USER") => ({ role, accessRoleId: str(fd, "accessRoleId").trim().slice(0, 64), warehouseIds: fd.getAll("warehouseIds").filter((v): v is string => typeof v === "string").map((v) => v.trim().slice(0, 64)).filter(Boolean).slice(0, 500) });
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

async function authorize(t: Dictionary): Promise<{ userId: string } | { error: UserResult }> {
  const session = await auth();
  if (!session?.user?.id) return { error: { ok: false, message: t.common.sessionExpired } };
  if (!canManageUsers(session.user)) return { error: { ok: false, message: t.users.err.noPermission } };
  return { userId: session.user.id };
}

function collect(issues: z.core.$ZodIssue[], t: Dictionary): UserResult {
  const fieldErrors: Partial<Record<UserField, string>> = {};
  for (const i of issues) fieldErrors[i.path[0] as UserField] ??= i.message;
  return { ok: false, message: Object.values(fieldErrors)[0] ?? t.common.checkForm, fieldErrors };
}

/** Optional avatar from the form (validated by content). */
async function readAvatar(fd: FormData, t: Dictionary): Promise<{ image: ValidImage | null } | { error: string }> {
  const file = fd.get("avatar");
  if (!(file instanceof File) || file.size === 0) return { image: null };
  const r = await validateImage(file);
  if (!("error" in r)) return { image: r };
  return { error: r.key === "type" ? t.profile.avatarType : r.key === "size" ? t.profile.avatarSize : t.profile.avatarNotImage };
}

/** Remove an avatar file this app created (user uploads or self-service profile avatars). */
async function removeAvatarFile(p: string | null) {
  await deleteImage(FOLDER, p);
  await deleteImage("avatars", p);
}

export async function createUser(formData: FormData): Promise<UserResult> {
  const t = await getDict();
  const a = await authorize(t);
  if ("error" in a) return a.error;
  if (!(formData instanceof FormData) || hasUnknownFields(formData)) return { ok: false, message: t.users.err.invalidRequest };
  const DUPLICATE = t.users.err.duplicate;

  const parsed = makeUserSchemas(t.users.val).create.safeParse({
    firstName: str(formData, "firstName"),
    lastName: str(formData, "lastName"),
    email: str(formData, "email"),
    phoneNumber: str(formData, "phoneNumber"),
    password: str(formData, "password"),
    confirmPassword: str(formData, "confirmPassword"),
    role: str(formData, "role"), // "OWNER" (or anything else) fails here
  });
  if (!parsed.success) return collect(parsed.error.issues, t);
  const avatar = await readAvatar(formData, t);
  if ("error" in avatar) return { ok: false, message: avatar.error, fieldErrors: { avatar: avatar.error } };
  const d = parsed.data;
  if (await db.user.findUnique({ where: { email: d.email }, select: { id: true } })) return { ok: false, message: DUPLICATE, fieldErrors: { email: DUPLICATE } };

  const passwordHash = await bcrypt.hash(d.password, BCRYPT_COST);
  const image = avatar.image ? await saveImage(FOLDER, avatar.image) : null;
  try {
    await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { firstName: d.firstName, lastName: d.lastName, email: d.email, phoneNumber: d.phoneNumber, role: d.role, passwordHash, image },
        select: { id: true }, // never read the hash back
      });
      await applyUserAccess(tx, { actorId: a.userId, userId: created.id, userName: `${d.firstName} ${d.lastName}`.trim(), input: accessOf(formData, d.role), t });
    });
  } catch (e) {
    await removeAvatarFile(image);
    if (e instanceof AccessRejected) return { ok: false, message: e.message, fieldErrors: { accessRoleId: e.message } };
    if (isUnique(e)) return { ok: false, message: DUPLICATE, fieldErrors: { email: DUPLICATE } };
    throw e;
  }
  revalidatePath("/users");
  return { ok: true, message: t.users.ok.created };
}

/**
 * Edit an ADMIN/USER account. Password fields are optional: empty keeps the existing hash; a new
 * password (confirmed) replaces it, so the old one stops working. The Owner account is locked.
 */
export async function updateUser(id: unknown, formData: FormData): Promise<UserResult> {
  const t = await getDict();
  const a = await authorize(t);
  if ("error" in a) return a.error;
  if (!(formData instanceof FormData) || hasUnknownFields(formData)) return { ok: false, message: t.users.err.invalidRequest };
  const DUPLICATE = t.users.err.duplicate;
  const uid = idSchema.safeParse(id);
  if (!uid.success) return { ok: false, message: t.users.err.notFound };

  const target = await db.user.findUnique({ where: { id: uid.data }, select: { id: true, role: true, image: true } });
  if (!target) return { ok: false, message: t.users.err.notFound };
  if (target.role === "OWNER" || target.id === a.userId) return { ok: false, message: t.users.err.ownerLocked };

  const parsed = makeUserSchemas(t.users.val).update.safeParse({
    firstName: str(formData, "firstName"),
    lastName: str(formData, "lastName"),
    email: str(formData, "email"),
    phoneNumber: str(formData, "phoneNumber"),
    password: str(formData, "password"),
    confirmPassword: str(formData, "confirmPassword"),
    role: str(formData, "role"),
  });
  if (!parsed.success) return collect(parsed.error.issues, t);
  const avatar = await readAvatar(formData, t);
  if ("error" in avatar) return { ok: false, message: avatar.error, fieldErrors: { avatar: avatar.error } };
  const d = parsed.data;
  if (await db.user.findFirst({ where: { email: d.email, NOT: { id: target.id } }, select: { id: true } })) {
    return { ok: false, message: DUPLICATE, fieldErrors: { email: DUPLICATE } };
  }

  const removeAvatar = formData.get("removeAvatar") === "on";
  const newImage = avatar.image ? await saveImage(FOLDER, avatar.image) : undefined; // undefined = keep
  const image = newImage !== undefined ? newImage : removeAvatar ? null : undefined;
  const newHash = d.password ? await bcrypt.hash(d.password, BCRYPT_COST) : null;
  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: {
          firstName: d.firstName,
          lastName: d.lastName,
          email: d.email,
          phoneNumber: d.phoneNumber,
          role: d.role,
          // A password reset also bumps sessionVersion in the same UPDATE (one transaction), so every
          // existing session of that user ends on its next request (auth.ts).
          ...(newHash ? { passwordHash: newHash, sessionVersion: { increment: 1 } } : {}),
          ...(image !== undefined ? { image } : {}),
        },
        select: { id: true },
      });
      await applyUserAccess(tx, { actorId: a.userId, userId: target.id, userName: `${d.firstName} ${d.lastName}`.trim(), input: accessOf(formData, d.role), t });
    });
  } catch (e) {
    if (newImage) await removeAvatarFile(newImage);
    if (e instanceof AccessRejected) return { ok: false, message: e.message, fieldErrors: { accessRoleId: e.message } };
    if (isUnique(e)) return { ok: false, message: DUPLICATE, fieldErrors: { email: DUPLICATE } };
    throw e;
  }
  if (image !== undefined && target.image !== image) await removeAvatarFile(target.image);
  revalidatePath("/users");
  return { ok: true, message: d.password ? t.users.ok.updatedPassword : t.users.ok.updated };
}

/**
 * Business records that keep a user's id as their author. Deleting such a user would orphan the
 * history, so deletion is refused. Add new modules' createdById/userId counts here as they arrive.
 */
async function findUserReferences(userId: string, t: Dictionary): Promise<string[]> {
  const [entries, transfers, adjustments] = await Promise.all([
    db.productStockEntry.count({ where: { createdById: userId } }),
    db.stockTransfer.count({ where: { createdById: userId } }),
    db.stockAdjustment.count({ where: { createdById: userId } }),
  ]);
  const out: string[] = [];
  const E = t.users.err;
  if (entries) out.push(fmt(entries === 1 ? E.entry : E.entries, { n: entries }));
  if (transfers) out.push(fmt(transfers === 1 ? E.transfer : E.transfers, { n: transfers }));
  if (adjustments) out.push(fmt(adjustments === 1 ? E.adjustment : E.adjustments, { n: adjustments }));
  return out;
}

export async function deleteUser(id: unknown): Promise<UserResult> {
  const t = await getDict();
  const a = await authorize(t);
  if ("error" in a) return a.error;
  const uid = idSchema.safeParse(id);
  if (!uid.success) return { ok: false, message: t.users.err.notFound };

  const target = await db.user.findUnique({ where: { id: uid.data }, select: { id: true, role: true, image: true } });
  if (!target) return { ok: false, message: t.users.err.notFound };
  if (target.id === a.userId) return { ok: false, message: t.users.err.deleteSelf };
  if (target.role === "OWNER") return { ok: false, message: t.users.err.deleteOwner };

  const refs = await findUserReferences(target.id, t);
  if (refs.length) {
    return { ok: false, message: fmt(t.users.err.blockers, { list: refs.join(t.users.err.sep) }) };
  }
  try {
    // Conditional on the role so a concurrent change can never delete an Owner.
    const r = await db.user.deleteMany({ where: { id: target.id, role: { in: ["ADMIN", "USER"] } } });
    if (r.count !== 1) return { ok: false, message: t.users.err.notFound };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") return { ok: false, message: t.users.err.inUse };
    throw e;
  }
  await removeAvatarFile(target.image);
  revalidatePath("/users");
  // Their existing session ends on its next request: auth.ts re-checks the account in MySQL.
  return { ok: true, message: t.users.ok.deleted };
}
