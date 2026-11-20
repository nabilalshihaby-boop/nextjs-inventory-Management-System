// Seeds (upserts) one administrator from SEED_ADMIN_* environment variables in .env.
// Run: npx prisma db seed
// Never logs, returns or stores the plain password or any other SEED_ADMIN_* value.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { PrismaClient, Role } from "../app/generated/prisma/client";

const REQUIRED = [
  "SEED_ADMIN_FIRST_NAME",
  "SEED_ADMIN_LAST_NAME",
  "SEED_ADMIN_EMAIL",
  "SEED_ADMIN_PASSWORD",
  "SEED_ADMIN_PHONE",
] as const;

function readEnv() {
  const value = (name: string) => process.env[name]?.trim() ?? "";

  const missing = REQUIRED.filter((name) => !value(name));
  if (missing.length) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }

  const email = value("SEED_ADMIN_EMAIL").toLowerCase();
  if (!z.email().safeParse(email).success) {
    throw new Error("SEED_ADMIN_EMAIL is not a valid email address");
  }

  // The password is used as-is (not trimmed) so it matches exactly what the admin types.
  const password = process.env.SEED_ADMIN_PASSWORD ?? "";
  if (password.length < 8) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 8 characters");
  }

  return {
    firstName: value("SEED_ADMIN_FIRST_NAME"),
    lastName: value("SEED_ADMIN_LAST_NAME"),
    email,
    password,
    phoneNumber: value("SEED_ADMIN_PHONE"),
    // Optional: missing or empty → null (no placeholder URL).
    image: value("SEED_ADMIN_IMAGE") || null,
  };
}

async function main() {
  const { password, ...admin } = readEnv();
  const passwordHash = await bcrypt.hash(password, 12);

  const prisma = new PrismaClient();
  try {
    const data = { ...admin, passwordHash, role: Role.ADMIN };
    const user = await prisma.user.upsert({
      where: { email: admin.email },
      create: data,
      update: data,
      select: { id: true, role: true },
    });
    console.log(`Seeded administrator (id ${user.id}, role ${user.role}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Only the message: never dump objects that could contain env values.
  console.error(`Seed failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
});
