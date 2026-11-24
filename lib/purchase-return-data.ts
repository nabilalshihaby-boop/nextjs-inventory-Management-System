// Server-only loaders for Purchase Returns (OWNER/ADMIN — callers check the role first).
import { warehouseIdFilter } from "@/lib/access-scope";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { formatDateOnly } from "@/lib/format";
import { getSystemSettings } from "@/lib/settings";
import type { ReturnSourcePurchase } from "@/lib/purchase-returns";

/**
 * RECEIVED purchases that still have something returnable, with their lines, what was already
 * returned and the current stock in the purchase warehouse. Display only — the server re-reads all
 * of it inside the locked transaction when saving.
 */
export async function getReturnSources(): Promise<ReturnSourcePurchase[]> {
  const settings = await getSystemSettings();
  const purchases = await db.purchase.findMany({
    where: { status: "RECEIVED", ...(await warehouseIdFilter()) },
    orderBy: { number: "desc" },
    select: {
      id: true, reference: true, purchaseDate: true, warehouseId: true, subtotal: true, orderTaxAmount: true, orderTaxRate: true, discount: true, grandTotal: true, paidAmount: true,
      supplier: { select: { name: true } },
      warehouse: { select: { name: true } },
      currency: { select: { code: true, symbol: true } },
      items: { orderBy: { id: "asc" }, select: { id: true, productId: true, quantity: true, unitName: true, unitFactor: true, netUnitCost: true, subtotal: true, taxAmount: true, discountAmount: true, product: { select: { code: true, name: true, purchaseUnit: { select: { name: true } }, productUnit: { select: { name: true } } } } } },
    },
  });
  if (!purchases.length) return [];
  const ids = purchases.map((p) => p.id);
  const [returnedByLine, returnedSub, stock] = await Promise.all([
    db.purchaseReturnItem.groupBy({ by: ["purchaseItemId"], where: { purchaseReturn: { purchaseId: { in: ids } } }, _sum: { quantity: true } }),
    db.purchaseReturn.groupBy({ by: ["purchaseId"], where: { purchaseId: { in: ids } }, _sum: { subtotal: true, grandTotal: true } }),
    db.productStock.findMany({ where: { productId: { in: [...new Set(purchases.flatMap((p) => p.items.map((i) => i.productId)))] } }, select: { productId: true, warehouseId: true, quantity: true } }),
  ]);
  const returned = new Map(returnedByLine.map((r) => [r.purchaseItemId, r._sum.quantity ?? new Prisma.Decimal(0)]));
  const retSub = new Map(returnedSub.map((r) => [r.purchaseId, r._sum.subtotal ?? new Prisma.Decimal(0)]));
  const retGrand = new Map(returnedSub.map((r) => [r.purchaseId, r._sum.grandTotal ?? new Prisma.Decimal(0)]));
  // Refunds / supplier credit aren't built: only purchases with something still unpaid can be returned.
  const due = (p: (typeof purchases)[number]) => p.grandTotal.minus(p.paidAmount).minus(retGrand.get(p.id) ?? 0);
  const onHand = new Map(stock.map((s) => [`${s.productId}|${s.warehouseId}`, s.quantity]));

  return purchases
    .filter((p) => due(p).gt(0))
    .map((p) => ({
      due: due(p).toFixed(2),
      id: p.id,
      reference: p.reference,
      date: p.purchaseDate.toISOString().slice(0, 10),
      dateLabel: formatDateOnly(p.purchaseDate, settings?.dateFormat),
      supplier: p.supplier.name,
      warehouse: p.warehouse.name,
      subtotal: p.subtotal.toFixed(2),
      orderTaxAmount: p.orderTaxAmount.toFixed(2),
      orderTaxRate: p.orderTaxRate.toFixed(2),
      discount: p.discount.toFixed(2),
      returnedSubtotal: (retSub.get(p.id) ?? new Prisma.Decimal(0)).toFixed(2),
      currency: { code: p.currency.code, symbol: p.currency.symbol, right: !!settings?.currencyIconRight },
      lines: p.items.map((i) => ({
        purchaseItemId: i.id,
        productId: i.productId,
        code: i.product.code,
        name: i.product.name,
        unit: i.unitName ?? i.product.purchaseUnit.name,
        factor: i.unitFactor.toFixed(6).replace(/\.?0+$/, ""),
        baseUnit: i.product.productUnit.name,
        quantity: i.quantity.toFixed(3),
        returned: (returned.get(i.id) ?? new Prisma.Decimal(0)).toFixed(3),
        stock: (onHand.get(`${i.productId}|${p.warehouseId}`) ?? new Prisma.Decimal(0)).toFixed(3),
        netUnitCost: i.netUnitCost.toFixed(2),
        subtotal: i.subtotal.toFixed(2),
        taxAmount: i.taxAmount.toFixed(2),
        discountAmount: i.discountAmount.toFixed(2),
      })),
    }))
    .filter((p) => p.lines.some((l) => new Prisma.Decimal(l.quantity).gt(l.returned)));
}

/** Σ completed return totals per purchase (for Due / payment status). */
export async function returnedTotals(purchaseIds: string[]): Promise<Map<string, string>> {
  if (!purchaseIds.length) return new Map();
  const rows = await db.purchaseReturn.groupBy({ by: ["purchaseId"], where: { purchaseId: { in: purchaseIds } }, _sum: { grandTotal: true } });
  return new Map(rows.map((r) => [r.purchaseId, (r._sum.grandTotal ?? new Prisma.Decimal(0)).toFixed(2)]));
}
