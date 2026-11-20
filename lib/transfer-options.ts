import { db } from "@/lib/db";
import { getDefaultCurrency } from "@/lib/settings";
import type { StockOption, WarehouseOption } from "@/lib/transfers";

/**
 * Real data for the Create/Edit Transfer form (OWNER/ADMIN pages only — it includes product cost):
 * every warehouse, and every product with positive on-hand stock per warehouse. The client only
 * uses this for display; the server re-checks warehouses, products, stock and cost on save.
 */
export async function getTransferFormData(): Promise<{
  warehouses: WarehouseOption[];
  stock: StockOption[];
  currency: { code: string; symbol: string; right: boolean } | null;
}> {
  const [warehouses, stocks, currency] = await Promise.all([
    db.warehouse.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.productStock.findMany({
      where: { quantity: { gt: 0 } },
      orderBy: { product: { name: "asc" } },
      select: {
        warehouseId: true,
        quantity: true,
        product: { select: { id: true, code: true, name: true, cost: true, productUnit: { select: { name: true } } } },
      },
    }),
    getDefaultCurrency(),
  ]);
  return {
    warehouses: warehouses.map((w) => ({ value: w.id, label: w.name })),
    stock: stocks.map((s) => ({
      warehouseId: s.warehouseId,
      productId: s.product.id,
      code: s.product.code,
      name: s.product.name,
      unit: s.product.productUnit.name,
      cost: s.product.cost.toFixed(2),
      available: s.quantity.toFixed(3),
    })),
    currency: currency ? { code: currency.code, symbol: currency.symbol, right: currency.right } : null,
  };
}

/** Today's date (server local) as YYYY-MM-DD, the form's default transfer date. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
