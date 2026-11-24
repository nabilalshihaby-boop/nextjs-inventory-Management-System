// Server-only loaders for the Purchases pages (OWNER/ADMIN — callers check the role first).
import { warehouseFilter, warehouseIdFilter } from "@/lib/access-scope";
import { db } from "@/lib/db";
import { getDefaultCurrency } from "@/lib/settings";
import { unitOptionsFor } from "@/lib/product-units";
import type { PurchaseOption, PurchaseProduct, PurchaseStockLevel } from "@/lib/purchases";

export type PurchaseFormData = {
  suppliers: PurchaseOption[];
  warehouses: PurchaseOption[];
  products: PurchaseProduct[];
  stock: PurchaseStockLevel[];
  currency: { code: string; symbol: string; right: boolean } | null;
};

/** Real options for Create Purchase. Line defaults come from each product (cost, tax); display only. */
export async function getPurchaseFormData(): Promise<PurchaseFormData> {
  const [suppliers, warehouses, products, stock, currency] = await Promise.all([
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.warehouse.findMany({ where: await warehouseFilter(), orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.product.findMany({ orderBy: { name: "asc" }, select: { id: true, code: true, name: true, cost: true, taxType: true, orderTax: true, purchaseUnit: { select: { name: true } } } }),
    db.productStock.findMany({ where: await warehouseIdFilter(), select: { productId: true, warehouseId: true, quantity: true } }),
    getDefaultCurrency(),
  ]);
  const units = await unitOptionsFor(db, products.map((p) => p.id));
  return {
    suppliers: suppliers.map((s) => ({ value: s.id, label: s.name })),
    warehouses: warehouses.map((w) => ({ value: w.id, label: w.name })),
    products: products.map((p) => ({ productId: p.id, code: p.code, name: p.name, cost: p.cost.toFixed(2), taxType: p.taxType, taxRate: p.orderTax.toFixed(2), unit: p.purchaseUnit.name, unitInfo: units.get(p.id)! })),
    stock: stock.map((s) => ({ productId: s.productId, warehouseId: s.warehouseId, quantity: s.quantity.toFixed(3) })),
    currency: currency ? { code: currency.code, symbol: currency.symbol, right: currency.right } : null,
  };
}
