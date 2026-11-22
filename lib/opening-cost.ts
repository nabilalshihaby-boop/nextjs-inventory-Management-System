import type { Prisma } from "@/app/generated/prisma/client";
import { loadCostHistory } from "@/lib/profit-loss";
import { runCosting } from "@/lib/profit-loss-core";
import { fromUnits, toUnits } from "@/lib/transfers";

// Opening Inventory Cost Setup — server-side logic (OWNER only; the page and the action both re-check the role).
// It only ever READS stock and history. The single thing it writes is the InventoryCostBaseline record (lib/../actions.ts):
// never a stock quantity, purchase, payment, expense, sale, ledger row or stock movement.

const ZERO = BigInt(0);

export type SetupRow = {
  productId: string;
  code: string;
  name: string;
  unit: string;
  /** Company-wide on-hand quantity in Base Units (including goods in transit between warehouses), "12.500". */
  onHand: string;
  /** The part of it whose cost is unknown — the quantity the Owner's cost will value. */
  uncosted: string;
};

/**
 * Products that currently have stock whose cost is unknown for this currency and that have no baseline yet.
 * Computed by replaying the same history as the Profit & Loss report, so the list and the report always agree.
 */
export async function getUncostedStock(client: Prisma.TransactionClient, currencyId: string, defaultCurrencyId: string | null): Promise<SetupRow[]> {
  // Currencyless legacy stock belongs ONLY to the System Settings default currency: nothing is ever offered for another currency
  // (no exchange rate is invented, and a selected-currency view never gets a baseline for stock that has no matching currency basis).
  if (currencyId !== defaultCurrencyId) return [];
  const hist = await loadCostHistory(client, currencyId, defaultCurrencyId);
  const have = new Set(hist.baselines.map((b) => b.productId));
  const eligible: { productId: string; qty: bigint; unc: bigint }[] = [];
  for (const [productId, events] of hist.byProduct) {
    if (have.has(productId)) continue;
    const { final } = runCosting(events);
    if (final.qty > ZERO && final.unc > ZERO) eligible.push({ productId, qty: final.qty, unc: final.unc });
  }
  if (eligible.length === 0) return [];
  const products = await client.product.findMany({ where: { id: { in: eligible.map((e) => e.productId) } }, select: { id: true, code: true, name: true, productUnit: { select: { name: true } } } });
  const info = new Map(products.map((p) => [p.id, p]));
  return eligible
    .map((e) => ({ productId: e.productId, code: info.get(e.productId)?.code ?? "", name: info.get(e.productId)?.name ?? "", unit: info.get(e.productId)?.productUnit.name ?? "", onHand: fromUnits(e.qty, 3), uncosted: fromUnits(e.unc, 3) }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** quantity (3 dp) × cost per Base Unit (2 dp) → total in cents, rounded half-up. Exact BigInt. */
export function baselineTotalCents(quantity: string, unitCost: string): bigint {
  return (toUnits(quantity, 3) * toUnits(unitCost, 2) + BigInt(500)) / BigInt(1000);
}

/** A baseline is locked as soon as any later costed inventory activity exists for the product (conservative: also by record time). */
export async function hasLaterCostedActivity(client: Prisma.TransactionClient, productId: string, since: Date): Promise<boolean> {
  const [a, b, c, d, e, f] = await Promise.all([
    client.purchaseItem.count({ where: { productId, purchase: { status: "RECEIVED", OR: [{ receivedAt: { gt: since } }, { createdAt: { gt: since } }] } } }),
    client.saleItem.count({ where: { productId, sale: { status: "COMPLETED", OR: [{ completedAt: { gt: since } }, { createdAt: { gt: since } }] } } }),
    client.saleReturnItem.count({ where: { productId, saleReturn: { createdAt: { gt: since } } } }),
    client.purchaseReturnItem.count({ where: { productId, purchaseReturn: { createdAt: { gt: since } } } }),
    client.stockAdjustmentItem.count({ where: { productId, adjustment: { createdAt: { gt: since } } } }),
    client.productStockEntry.count({ where: { productId, status: "RECEIVED", createdAt: { gt: since } } }),
  ]);
  return a + b + c + d + e + f > 0;
}
