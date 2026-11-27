// A person's name as stored on a record when they act. Always read from the database, never from the session or the client.
import type { Prisma } from "@/app/generated/prisma/client";

export const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();

export async function actorName(tx: Prisma.TransactionClient, userId: string): Promise<string | null> {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
  return u ? fullName(u) || null : null;
}
