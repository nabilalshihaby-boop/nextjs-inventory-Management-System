import type { Prisma } from "@/app/generated/prisma/client";
import { Prisma as P } from "@/app/generated/prisma/client";
import { compareMovements, fmtQty, loadMovements } from "@/lib/inventory-reports";
import { LocalizedError } from "@/lib/i18n/messages";

// Chronological stock-history guard (server-only). The current-stock checks (conditional UPDATE … WHERE
// quantity >= n) only prove that stock never goes below zero NOW. A document dated in the past — a return,
// a transfer, an adjustment — also changes every later balance of that product + warehouse, so the Stock Card
// (lib/inventory-reports.ts) could show a negative running balance between two dates even though today's stock
// is fine. This guard rebuilds the affected timeline INSIDE the writing transaction and rejects the operation
// (the transaction rolls back, nothing is written) if any balance from the changed position onward is negative.
//
// How it stays correct:
// - Call it AFTER the documents and the stock mutation of the same transaction have been written, so the
//   timeline already contains the proposed change (inserted, edited or removed).
// - It re-locks the (product, warehouse) stock rows FOR UPDATE first. Every stock-changing write takes that
//   row lock too, so concurrent writers for the same pair queue up, and the transaction must be READ COMMITTED
//   so the timeline it reads includes whatever the previous writer committed.
// - The timeline is the same one the report shows (loadMovements). Stock that exists without any recorded
//   movement (stock entered before history was kept) is treated as an opening balance at the beginning of time,
//   exactly like the report's "unexplained difference" — it is never invented as a movement.
// - Adding stock can never make a balance negative, so purchases, sales returns, product creation and the CSV
//   import (new products) are positive-only and don't need it.

export type HistoryPoint = {
  productId: string;
  warehouseId: string;
  /** Effective business day (YYYY-MM-DD) of the earliest changed movement. */
  day: string;
  /** Record timestamp (ms) of that movement, the same-day tie-break used by the ledger. */
  at: number;
};

export class StockHistoryError extends LocalizedError {
  constructor(vars: { product: string; warehouse: string; date: string; balance: string }, productId: string) {
    super("stockGuard.err.negative", vars, productId);
  }
}

type Client = Prisma.TransactionClient;

export async function assertNonNegativeHistory(tx: Client, points: HistoryPoint[]): Promise<void> {
  // One check per product + warehouse, from the EARLIEST changed position; stable order (no lock-order surprises).
  const byPair = new Map<string, HistoryPoint>();
  for (const p of points) {
    const k = `${p.productId}|${p.warehouseId}`;
    const cur = byPair.get(k);
    if (!cur || p.day < cur.day || (p.day === cur.day && p.at < cur.at)) byPair.set(k, p);
  }
  for (const [, pt] of [...byPair].sort(([a], [b]) => a.localeCompare(b))) {
    await tx.$queryRaw`SELECT id FROM product_stocks WHERE productId = ${pt.productId} AND warehouseId = ${pt.warehouseId} FOR UPDATE`;
    const [events, stock] = await Promise.all([
      loadMovements(tx, pt.productId, pt.warehouseId),
      tx.productStock.findUnique({ where: { productId_warehouseId: { productId: pt.productId, warehouseId: pt.warehouseId } }, select: { quantity: true } }),
    ]);
    const sorted = events.sort(compareMovements);
    const total = sorted.reduce((n, m) => n.plus(m.qty), new P.Decimal(0));
    // Stock with no recorded movement = an opening balance before everything else.
    let run = (stock?.quantity ?? new P.Decimal(0)).minus(total);
    for (const m of sorted) {
      run = run.plus(m.qty);
      const atOrAfter = m.day > pt.day || (m.day === pt.day && m.at >= pt.at);
      if (atOrAfter && run.isNegative()) {
        const [product, warehouse] = await Promise.all([
          tx.product.findUnique({ where: { id: pt.productId }, select: { code: true, name: true } }),
          tx.warehouse.findUnique({ where: { id: pt.warehouseId }, select: { name: true } }),
        ]);
        throw new StockHistoryError({ product: product ? `${product.code} ${product.name}` : "", warehouse: warehouse?.name ?? "", date: m.day, balance: fmtQty(run) }, pt.productId);
      }
    }
  }
}
