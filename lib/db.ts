import { PrismaClient } from "@/app/generated/prisma/client";

// Reuse one PrismaClient across hot reloads in development so `next dev`
// does not open a new connection pool on every module re-evaluation.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
