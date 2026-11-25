import { warehouseFilter, warehouseIdFilter } from "@/lib/access-scope";
import { db } from "@/lib/db";
import type { ProductPick, StockLevel } from "@/lib/adjustments";
import { barcodesOf, unitOptionsFor } from "@/lib/product-units";
import type { WarehouseOption } from "@/lib/transfers";

/**
 * Real data for the Create/Edit Adjustment form: warehouses, all products (any product can be
 * added to stock) and current on-hand stock per product/warehouse. Display only — the server
 * re-reads everything inside the transaction when saving.
 */
export async function getAdjustmentFormData(): Promise<{ warehouses: WarehouseOption[]; products: ProductPick[]; stock: StockLevel[] }> {
  const [warehouses, products, stock] = await Promise.all([
    db.warehouse.findMany({ where: await warehouseFilter(), orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.product.findMany({ orderBy: { name: "asc" }, select: { id: true, code: true, name: true, productUnit: { select: { name: true } } } }),
    db.productStock.findMany({ where: await warehouseIdFilter(), select: { productId: true, warehouseId: true, quantity: true } }),
  ]);
  const units = await unitOptionsFor(db, products.map((p) => p.id));
  const barcodes = await barcodesOf(db, products.map((p) => p.id));
  return {
    warehouses: warehouses.map((w) => ({ value: w.id, label: w.name })),
    products: products.map((p) => ({ productId: p.id, code: p.code, name: p.name, unit: p.productUnit.name, unitInfo: units.get(p.id)!, barcodes: barcodes.get(p.id) ?? [] })),
    stock: stock.map((s) => ({ productId: s.productId, warehouseId: s.warehouseId, quantity: s.quantity.toFixed(3) })),
  };
}
