// Server-only stock deduction shared by Sales (completion) and POS checkout, so there is exactly one
// implementation of "a sale takes stock out of a warehouse".
import { Prisma } from "@/app/generated/prisma/client";
import { formatQuantity } from "@/lib/money";
import { LocalizedError, type Vars } from "@/lib/i18n/messages";
import { dayOfTimestamp } from "@/lib/inventory-reports";
import { assertNonNegativeHistory } from "@/lib/stock-history-guard";

// Carries a dictionary key (+ variables) instead of English text; the caller translates it with errorMessage().
export class SaleError extends LocalizedError {
  constructor(key: string, vars: Vars = {}, itemId?: string) {
    super(key, vars, itemId);
  }
}

/**
 * Deduct every line from the warehouse — conditional (never below zero), stable lock order.
 * Throws SaleError (→ the caller's transaction rolls back) naming the first line without stock.
 * `at` is the moment the sale completes (the same Date stored as completedAt): after the stock is taken, the
 * chronological history of every line is re-checked (it can fail when later-dated movements already exist).
 */
export async function deductStock(tx: Prisma.TransactionClient, warehouseId: string, rawLines: { productId: string; quantity: Prisma.Decimal | string; productCode: string; productName: string }[], at: Date) {
  // Several lines may take the SAME product (different units, already converted to base quantity): add them up first so the
  // availability check and the error message are about the product's TOTAL need, never line by line.
  const byProduct = new Map<string, { productId: string; quantity: Prisma.Decimal; productCode: string; productName: string }>();
  for (const l of rawLines) {
    const q = new Prisma.Decimal(l.quantity);
    const cur = byProduct.get(l.productId);
    if (cur) cur.quantity = cur.quantity.add(q);
    else byProduct.set(l.productId, { productId: l.productId, quantity: q, productCode: l.productCode, productName: l.productName });
  }
  const lines = [...byProduct.values()];
  for (const l of [...lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
    const r = await tx.productStock.updateMany({ where: { productId: l.productId, warehouseId, quantity: { gte: l.quantity } }, data: { quantity: { decrement: l.quantity } } });
    if (r.count !== 1) {
      const [s, w] = await Promise.all([
        tx.productStock.findUnique({ where: { productId_warehouseId: { productId: l.productId, warehouseId } }, select: { quantity: true } }),
        tx.warehouse.findUnique({ where: { id: warehouseId }, select: { name: true } }),
      ]);
      throw new SaleError(w?.name ? "sales.err.notEnoughStock" : "sales.err.notEnoughStockNoWh", { code: l.productCode, name: l.productName, warehouse: w?.name ?? "", needed: formatQuantity(new Prisma.Decimal(l.quantity).toFixed(3)), available: formatQuantity((s?.quantity ?? new Prisma.Decimal(0)).toFixed(3)) }, l.productId);
    }
  }
  await assertNonNegativeHistory(tx, lines.map((l) => ({ productId: l.productId, warehouseId, day: dayOfTimestamp(at), at: at.getTime() })));
}
