// Server-only loaders for Sales Returns (OWNER/ADMIN — callers check the role first).
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { formatDateOnly, formatDateTime } from "@/lib/format";
import { getDefaultCurrency, getSystemSettings } from "@/lib/settings";
import type { SaleReturnRow, SaleReturnSource } from "@/lib/sale-returns";

/**
 * COMPLETED sales that still have something returnable AND an unpaid balance, with their stored
 * lines, what was already returned and the current stock in the sale warehouse. Display only — the
 * server re-reads all of it inside the locked transaction when saving.
 */
export async function getSaleReturnSources(): Promise<SaleReturnSource[]> {
  const settings = await getSystemSettings();
  const sales = await db.sale.findMany({
    where: { status: "COMPLETED" },
    orderBy: { number: "desc" },
    select: {
      id: true, reference: true, saleDate: true, warehouseId: true, subtotal: true, orderTaxAmount: true, orderTaxRate: true, discount: true, grandTotal: true, paidAmount: true,
      customer: { select: { name: true } },
      warehouse: { select: { name: true } },
      currency: { select: { code: true, symbol: true } },
      items: { orderBy: { id: "asc" }, select: { id: true, productId: true, productCode: true, productName: true, unitName: true, quantity: true, netUnitPrice: true, subtotal: true, taxAmount: true, discountAmount: true } },
    },
  });
  if (!sales.length) return [];
  const ids = sales.map((s) => s.id);
  const [returnedByLine, returnedSums, stock] = await Promise.all([
    db.saleReturnItem.groupBy({ by: ["saleItemId"], where: { saleReturn: { saleId: { in: ids } } }, _sum: { quantity: true } }),
    db.saleReturn.groupBy({ by: ["saleId"], where: { saleId: { in: ids } }, _sum: { subtotal: true, grandTotal: true } }),
    db.productStock.findMany({ where: { productId: { in: [...new Set(sales.flatMap((s) => s.items.map((i) => i.productId)))] } }, select: { productId: true, warehouseId: true, quantity: true } }),
  ]);
  const zero = new Prisma.Decimal(0);
  const returned = new Map(returnedByLine.map((r) => [r.saleItemId, r._sum.quantity ?? zero]));
  const retSub = new Map(returnedSums.map((r) => [r.saleId, r._sum.subtotal ?? zero]));
  const retGrand = new Map(returnedSums.map((r) => [r.saleId, r._sum.grandTotal ?? zero]));
  const onHand = new Map(stock.map((s) => [`${s.productId}|${s.warehouseId}`, s.quantity]));
  // Refunds / customer credit aren't built: only sales with something still unpaid can be returned.
  const due = (s: (typeof sales)[number]) => s.grandTotal.minus(s.paidAmount).minus(retGrand.get(s.id) ?? zero);

  return sales
    .filter((s) => due(s).gt(0))
    .map((s) => ({
      id: s.id,
      reference: s.reference,
      due: due(s).toFixed(2),
      date: s.saleDate.toISOString().slice(0, 10),
      dateLabel: formatDateOnly(s.saleDate, settings?.dateFormat),
      customer: s.customer.name,
      warehouse: s.warehouse.name,
      subtotal: s.subtotal.toFixed(2),
      orderTaxAmount: s.orderTaxAmount.toFixed(2),
      orderTaxRate: s.orderTaxRate.toFixed(2),
      discount: s.discount.toFixed(2),
      returnedSubtotal: (retSub.get(s.id) ?? zero).toFixed(2),
      currency: { code: s.currency.code, symbol: s.currency.symbol, right: !!settings?.currencyIconRight },
      lines: s.items.map((i) => ({
        saleItemId: i.id,
        productId: i.productId,
        code: i.productCode,
        name: i.productName,
        unit: i.unitName,
        quantity: i.quantity.toFixed(3),
        returned: (returned.get(i.id) ?? zero).toFixed(3),
        stock: (onHand.get(`${i.productId}|${s.warehouseId}`) ?? zero).toFixed(3),
        netUnitPrice: i.netUnitPrice.toFixed(2),
        subtotal: i.subtotal.toFixed(2),
        taxAmount: i.taxAmount.toFixed(2),
        discountAmount: i.discountAmount.toFixed(2),
      })),
    }))
    .filter((s) => s.lines.some((l) => new Prisma.Decimal(l.quantity).gt(l.returned)));
}

/** Σ completed sales-return grand totals per sale (for Due / payment status). */
export async function saleReturnedTotals(saleIds: string[]): Promise<Map<string, string>> {
  if (!saleIds.length) return new Map();
  const rows = await db.saleReturn.groupBy({ by: ["saleId"], where: { saleId: { in: saleIds } }, _sum: { grandTotal: true } });
  return new Map(rows.map((r) => [r.saleId, (r._sum.grandTotal ?? new Prisma.Decimal(0)).toFixed(2)]));
}

export async function getSaleReturnRows(): Promise<SaleReturnRow[]> {
  const [returns, settings, def] = await Promise.all([
    db.saleReturn.findMany({
      orderBy: { number: "desc" },
      select: { id: true, reference: true, returnDate: true, grandTotal: true, createdAt: true, currencyId: true, customerId: true, currency: { select: { code: true, symbol: true } }, sale: { select: { id: true, reference: true } }, customer: { select: { name: true } }, warehouse: { select: { name: true } } },
    }),
    getSystemSettings(),
    getDefaultCurrency(),
  ]);
  return returns.map((r) => ({
    id: r.id,
    reference: r.reference,
    saleRef: r.sale.reference,
    saleId: r.sale.id,
    customerId: r.customerId,
    customer: r.customer.name,
    warehouse: r.warehouse.name,
    date: r.returnDate.toISOString().slice(0, 10),
    dateLabel: formatDateOnly(r.returnDate, settings?.dateFormat),
    grandTotal: r.grandTotal.toFixed(2),
    currency: { code: r.currency.code, symbol: r.currency.symbol, right: !!settings?.currencyIconRight },
    inDefaultCurrency: !!def && r.currencyId === def.id,
    createdOn: formatDateTime(r.createdAt, settings?.dateFormat),
  }));
}
