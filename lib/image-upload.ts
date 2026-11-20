// Server-side only (uses node:fs); imported from Server Actions.
import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// Image uploads stored under public/uploads/<folder> (same safety rules as the profile avatar).
// LOCAL DEVELOPMENT ONLY: files written to public/ at runtime are served by `next dev`, but a
// production server only serves files that existed at build time, and the disk may not persist.
// Production needs persistent object storage (e.g. S3-compatible) instead of this helper.

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

type ImageKind = "jpg" | "png" | "webp";

/** Identify the real image type from the file's first bytes (never trust name or MIME alone). */
function sniffImage(bytes: Uint8Array): ImageKind | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a) return "png";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}

export type ValidImage = { bytes: Uint8Array; ext: ImageKind };

/** Validate an uploaded File: extension, declared type, size and actual content. */
export async function validateImage(file: File): Promise<ValidImage | { error: string }> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext) || !ALLOWED_MIME.has(file.type)) return { error: "Use a JPG, PNG or WebP image" };
  if (file.size > MAX_IMAGE_BYTES) return { error: "Image must be 2 MB or smaller" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) return { error: "This file is not a valid JPG, PNG or WebP image" };
  return { bytes, ext: kind };
}

const folderDir = (folder: string) => path.join(process.cwd(), "public", "uploads", folder);
const ownPath = (folder: string) => new RegExp(`^/uploads/${folder}/[a-f0-9]{32}\\.(jpg|png|webp)$`);

/** Save a validated image under a random name; returns the relative URL path to store. */
export async function saveImage(folder: string, image: ValidImage): Promise<string> {
  const name = `${randomBytes(16).toString("hex")}.${image.ext}`;
  await mkdir(folderDir(folder), { recursive: true });
  await writeFile(path.join(folderDir(folder), name), image.bytes);
  return `/uploads/${folder}/${name}`;
}

/** Delete a file previously created by saveImage (anything else is ignored). */
export async function deleteImage(folder: string, relativePath: string | null | undefined) {
  if (!relativePath || !ownPath(folder).test(relativePath)) return;
  await unlink(path.join(folderDir(folder), path.basename(relativePath))).catch(() => {});
}
