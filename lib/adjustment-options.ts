import { db } from "@/lib/db";
import type { ProductPick, StockLevel } from "@/lib/adjustments";
import type { WarehouseOption } from "@/lib/transfers";

/**
 * Real data for the Create/Edit Adjustment form: warehouses, all products (any product can be
 * added to stock) and current on-hand stock per product/warehouse. Display only — the server
 * re-reads everything inside the transaction when saving.
 */
export async function getAdjustmentFormData(): Promise<{ warehouses: WarehouseOption[]; products: ProductPick[]; stock: StockLevel[] }> {
  const [warehouses, products, stock] = await Promise.all([
    db.warehouse.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.product.findMany({ orderBy: { name: "asc" }, select: { id: true, code: true, name: true, productUnit: { select: { name: true } } } }),
    db.productStock.findMany({ select: { productId: true, warehouseId: true, quantity: true } }),
  ]);
  return {
    warehouses: warehouses.map((w) => ({ value: w.id, label: w.name })),
    products: products.map((p) => ({ productId: p.id, code: p.code, name: p.name, unit: p.productUnit.name })),
    stock: stock.map((s) => ({ productId: s.productId, warehouseId: s.warehouseId, quantity: s.quantity.toFixed(3) })),
  };
}
