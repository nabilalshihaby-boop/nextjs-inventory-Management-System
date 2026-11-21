// Server-only (returns the open session reference, or null): an account with an OPEN register session can't be deactivated or turned into a bank account.
import type { Prisma } from "@/app/generated/prisma/client";

export async function openRegisterBlock(tx: Prisma.TransactionClient, accountId: string): Promise<string | null> {
  await tx.$queryRaw`SELECT id FROM cash_bank_accounts WHERE id = ${accountId} FOR UPDATE`;
  const open = await tx.cashRegisterSession.findFirst({ where: { cashBankAccountId: accountId, status: "OPEN" }, select: { reference: true } });
  return open ? open.reference : null;
}
