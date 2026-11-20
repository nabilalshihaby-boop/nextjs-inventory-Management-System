// Seeds (creates or updates) the primary account (role OWNER) from SEED_ADMIN_* variables in .env.
// Run: npx prisma db seed
//
// Password rules:
// - Account does not exist yet → SEED_ADMIN_PASSWORD is required and hashed.
// - Account already exists     → the current passwordHash is preserved (a password changed in the
//   app is never overwritten), unless SEED_ADMIN_RESET_PASSWORD is exactly "true": then
//   SEED_ADMIN_PASSWORD is required and only the hash is replaced.
// Profile fields (name, email, phone, image) and role OWNER are always applied, as before.
//
// Never logs, returns or stores the plain password or any other SEED_ADMIN_* value.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { PrismaClient, Role } from "../app/generated/prisma/client";

const REQUIRED_PROFILE = [
  "SEED_ADMIN_FIRST_NAME",
  "SEED_ADMIN_LAST_NAME",
  "SEED_ADMIN_EMAIL",
  "SEED_ADMIN_PHONE",
] as const;

const value = (name: string) => process.env[name]?.trim() ?? "";

function readProfile() {
  const missing = REQUIRED_PROFILE.filter((name) => !value(name));
  if (missing.length) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }

  const email = value("SEED_ADMIN_EMAIL").toLowerCase();
  if (!z.email().safeParse(email).success) {
    throw new Error("SEED_ADMIN_EMAIL is not a valid email address");
  }

  return {
    firstName: value("SEED_ADMIN_FIRST_NAME"),
    lastName: value("SEED_ADMIN_LAST_NAME"),
    email,
    phoneNumber: value("SEED_ADMIN_PHONE"),
    // Optional: missing or empty → null (no placeholder URL).
    image: value("SEED_ADMIN_IMAGE") || null,
  };
}

/** SEED_ADMIN_PASSWORD hashed, or an error naming the reason it is needed. Never echoes the value. */
async function requirePasswordHash(reason: string) {
  // Used as-is (not trimmed) so it matches exactly what the user types at login.
  const password = process.env.SEED_ADMIN_PASSWORD ?? "";
  if (!password) throw new Error(`SEED_ADMIN_PASSWORD is required ${reason}`);
  if (password.length < 8) throw new Error("SEED_ADMIN_PASSWORD must be at least 8 characters");
  return bcrypt.hash(password, 12);
}

async function main() {
  const profile = readProfile();
  const resetRequested = process.env.SEED_ADMIN_RESET_PASSWORD === "true"; // exactly "true"
  const resetFlagIgnored = !resetRequested && value("SEED_ADMIN_RESET_PASSWORD") !== "";

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { email: profile.email }, select: { id: true } });

    if (!existing) {
      const passwordHash = await requirePasswordHash("to create the primary account");
      const user = await prisma.user.create({
        data: { ...profile, passwordHash, role: Role.OWNER },
        select: { id: true, role: true },
      });
      console.log(`Created primary account (id ${user.id}, role ${user.role}); password set.`);
      return;
    }

    // Existing account: update profile fields + role; the hash only on an explicit reset.
    const passwordHash = resetRequested
      ? await requirePasswordHash("when SEED_ADMIN_RESET_PASSWORD=true")
      : undefined;
    const user = await prisma.user.update({
      where: { id: existing.id },
      // An explicit password reset also bumps sessionVersion (same UPDATE), ending every existing
      // session of the account; without a reset, sessions are left alone.
      data: { ...profile, role: Role.OWNER, ...(passwordHash ? { passwordHash, sessionVersion: { increment: 1 } } : {}) },
      select: { id: true, role: true },
    });
    console.log(
      `Updated primary account (id ${user.id}, role ${user.role}); ` +
        (passwordHash ? "password reset (SEED_ADMIN_RESET_PASSWORD=true); existing sessions signed out." : "password unchanged."),
    );
    if (resetFlagIgnored) {
      console.log('Note: SEED_ADMIN_RESET_PASSWORD is set but not exactly "true", so the password was not reset.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Only the message: never dump objects that could contain env values.
  console.error(`Seed failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
});
