"use server";

import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { auth, updateSession } from "@/auth";
import { db } from "@/lib/db";

export type ProfileValues = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  image: string | null;
};

export type ProfileFieldErrors = Partial<Record<"firstName" | "lastName" | "email" | "phoneNumber" | "avatar", string>>;

export type ProfileState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors: ProfileFieldErrors }
  | { status: "success"; message: string; values: ProfileValues };

const profileSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100, "First name is too long"),
  lastName: z.string().trim().min(1, "Last name is required").max(100, "Last name is too long"),
  email: z.string().trim().toLowerCase().max(191, "Email is too long").pipe(z.email("Enter a valid email")),
  phoneNumber: z
    .string()
    .trim()
    .min(1, "Phone number is required")
    .regex(/^[0-9+()\-.\s]{6,32}$/, "Enter a valid phone number"),
});

// ---- Avatar upload (local-development storage under public/, publicly reachable) ----
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_DIR = path.join(process.cwd(), "public", "uploads", "avatars");
const AVATAR_URL_PREFIX = "/uploads/avatars/";
const UPLOADED_AVATAR = /^\/uploads\/avatars\/[a-f0-9]{32}\.(jpg|png|webp)$/;
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Identify the real image type from the file's first bytes (never trust name or MIME alone). */
function sniffImage(bytes: Uint8Array): "jpg" | "png" | "webp" | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a) return "png";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}

async function readAvatar(file: File): Promise<{ bytes: Uint8Array; ext: "jpg" | "png" | "webp" } | { error: string }> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext) || !ALLOWED_MIME.has(file.type)) {
    return { error: "Use a JPG, PNG or WebP image" };
  }
  if (file.size > MAX_AVATAR_BYTES) return { error: "Image must be 2 MB or smaller" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) return { error: "This file is not a valid JPG, PNG or WebP image" };
  return { bytes, ext: kind };
}

async function removeUploadedAvatar(imagePath: string | null) {
  // Only files this action created are deleted (never seeded or external images).
  if (!imagePath || !UPLOADED_AVATAR.test(imagePath)) return;
  await unlink(path.join(AVATAR_DIR, path.basename(imagePath))).catch(() => {});
}

const text = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

export async function updateProfile(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  // Identity comes only from the session — never from the form. Any id/role/password/image
  // fields a client might add to the FormData are simply never read.
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { status: "error", message: "Your session has expired. Please sign in again.", fieldErrors: {} };

  const current = await db.user.findUnique({ where: { id: userId }, select: { image: true } });
  if (!current) return { status: "error", message: "Your account could not be found.", fieldErrors: {} };

  const parsed = profileSchema.safeParse({
    firstName: text(formData.get("firstName")),
    lastName: text(formData.get("lastName")),
    email: text(formData.get("email")),
    phoneNumber: text(formData.get("phoneNumber")),
  });
  const fieldErrors: ProfileFieldErrors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof ProfileFieldErrors;
      fieldErrors[key] ??= issue.message;
    }
  }

  const removeAvatar = formData.get("removeAvatar") === "on";
  const file = formData.get("avatar");
  let upload: { bytes: Uint8Array; ext: string } | null = null;
  if (file instanceof File && file.size > 0 && !removeAvatar) {
    const result = await readAvatar(file);
    if ("error" in result) fieldErrors.avatar = result.error;
    else upload = result;
  }

  if (parsed.success && !fieldErrors.email) {
    const taken = await db.user.findFirst({
      where: { email: parsed.data.email, NOT: { id: userId } },
      select: { id: true },
    });
    if (taken) fieldErrors.email = "This email is already used by another account";
  }

  if (!parsed.success || Object.keys(fieldErrors).length) {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors };
  }

  // Save the new file first so the database never points at a missing image.
  let newImage: string | null | undefined; // undefined = keep current
  if (upload) {
    const name = `${randomBytes(16).toString("hex")}.${upload.ext}`;
    await mkdir(AVATAR_DIR, { recursive: true });
    await writeFile(path.join(AVATAR_DIR, name), upload.bytes);
    newImage = AVATAR_URL_PREFIX + name;
  } else if (removeAvatar) {
    newImage = null;
  }

  let saved: ProfileValues;
  try {
    saved = await db.user.update({
      where: { id: userId },
      // Self-service profile updates must never modify role (or passwordHash): only these
      // five columns are writable here, whatever the client sends.
      data: { ...parsed.data, ...(newImage !== undefined ? { image: newImage } : {}) },
      select: { firstName: true, lastName: true, email: true, phoneNumber: true, image: true },
    });
  } catch (error) {
    if (newImage) await removeUploadedAvatar(newImage);
    // Unique-constraint race: another account took the email after our check.
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
      return { status: "error", message: "Please fix the highlighted fields.", fieldErrors: { email: "This email is already used by another account" } };
    }
    throw error;
  }

  if (newImage !== undefined && current.image !== newImage) await removeUploadedAvatar(current.image);

  // Re-issue the session cookie from the database record (see the jwt callback in auth.ts).
  // The client then calls router.refresh(): that new request carries the new cookie, so the
  // layout's auth() — which reads the incoming request — sees the updated name/avatar.
  await updateSession({});

  return { status: "success", message: "Profile updated.", values: saved };
}
