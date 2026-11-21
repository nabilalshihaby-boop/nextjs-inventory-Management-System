// Server-only stock deduction shared by Sales (completion) and POS checkout, so there is exactly one
// implementation of "a sale takes stock out of a warehouse".
import { Prisma } from "@/app/generated/prisma/client";
import { formatQuantity } from "@/lib/money";

export class SaleError extends Error {
  constructor(message: string, readonly itemId?: string) {
    super(message);
  }
}

/**
 * Deduct every line from the warehouse — conditional (never below zero), stable lock order.
 * Throws SaleError (→ the caller's transaction rolls back) naming the first line without stock.
 */
export async function deductStock(tx: Prisma.TransactionClient, warehouseId: string, lines: { productId: string; quantity: Prisma.Decimal | string; productCode: string; productName: string }[]) {
  for (const l of [...lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
    const r = await tx.productStock.updateMany({ where: { productId: l.productId, warehouseId, quantity: { gte: l.quantity } }, data: { quantity: { decrement: l.quantity } } });
    if (r.count !== 1) {
      const [s, w] = await Promise.all([
        tx.productStock.findUnique({ where: { productId_warehouseId: { productId: l.productId, warehouseId } }, select: { quantity: true } }),
        tx.warehouse.findUnique({ where: { id: warehouseId }, select: { name: true } }),
      ]);
      throw new SaleError(`Not enough stock of ${l.productCode} ${l.productName} in ${w?.name ?? "the warehouse"}: ${formatQuantity(new Prisma.Decimal(l.quantity).toFixed(3))} needed, only ${formatQuantity((s?.quantity ?? new Prisma.Decimal(0)).toFixed(3))} available.`, l.productId);
    }
  }
}
