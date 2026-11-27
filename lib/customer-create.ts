// Server-only: the ONE way a new customer row is written (the Customers page and the POS quick add both use it), so the duplicate rule
// is the same everywhere. Callers authorize and validate first.
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";

export const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

type Created = { id: string; name: string };

/**
 * Insert a customer. The name is unique regardless of case (column collation): checked first for a clean answer, and the database's
 * unique index decides between concurrent requests. `also` runs in the same transaction (e.g. the audit event).
 */
export async function insertCustomer(data: Prisma.CustomerCreateInput, also?: (tx: Prisma.TransactionClient, customer: Created) => Promise<void>): Promise<{ ok: true; customer: Created } | { ok: false; duplicate: true }> {
  if (await db.customer.findUnique({ where: { name: data.name }, select: { id: true } })) return { ok: false, duplicate: true };
  try {
    const customer = await db.$transaction(async (tx) => {
      const c = await tx.customer.create({ data, select: { id: true, name: true } });
      await also?.(tx, c);
      return c;
    });
    return { ok: true, customer };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, duplicate: true };
    throw e;
  }
}
