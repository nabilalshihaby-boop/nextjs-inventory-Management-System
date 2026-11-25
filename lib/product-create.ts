import type { Prisma } from "@/app/generated/prisma/client";
import type { ProductFields, UnitInput } from "@/lib/products";
import { syncProductIdentifiers } from "@/lib/product-identifiers";

// The ONE place that writes a new product with its opening stock. Used by the Create Product
// action and by the CSV import so both produce identical records (server-only; call inside a transaction).

/** Column data of a Product (decimal strings → Prisma Decimal; no floating point). */
export const productFieldData = (f: ProductFields) => ({
  name: f.name,
  code: f.code,
  categoryId: f.categoryId,
  brandId: f.brandId,
  barcodeSymbology: f.barcodeSymbology,
  cost: f.cost,
  price: f.price,
  productUnitId: f.productUnitId,
  saleUnitId: f.saleUnitId,
  purchaseUnitId: f.purchaseUnitId,
  stockAlert: f.stockAlert,
  orderTax: f.orderTax,
  taxType: f.taxType,
  quantityLimitation: f.quantityLimitation === "" ? null : f.quantityLimitation,
  notes: f.notes === "" ? null : f.notes,
});

/**
 * Stock recorded together with a new product. PRODUCT_FORM = opening stock typed in Create Product (recorded
 * against a supplier). INITIAL_STOCK = initial inventory from the CSV import: never a supplier, never a
 * purchase, never a financial entry — it only creates the entry (the immutable source record) and on-hand stock.
 */
export type NewStock = { warehouseId: string; quantity: string; status: "RECEIVED" | "PENDING" | "ORDERED" } & (
  | { source: "PRODUCT_FORM"; supplierId: string }
  | { source: "INITIAL_STOCK"; supplierId: null }
);

/**
 * Creates the product, its image rows, and (when given) exactly one opening-stock entry recorded with
 * who created it. Only RECEIVED stock is on hand: PENDING / ORDERED entries don't change "In Stock".
 */
export async function createProductRecord(
  tx: Prisma.TransactionClient,
  f: ProductFields,
  stock: NewStock | null,
  userId: string,
  imagePaths: string[] = [],
  units: UnitInput[] = [],
  /** Base Unit barcode: a normalized string = explicit; null / undefined = none. A barcode is NEVER derived from the SKU any more. */
  baseBarcode?: string | null,
  /** Family + variant columns (lib/product-families.ts familyColumns, computed in this same transaction); omitted = standalone. */
  familyData?: { familyId: string | null; variantValue1: string | null; variantValue2: string | null; variantValue3: string | null; variantKey: string | null },
): Promise<{ id: string }> {
  const p = await tx.product.create({
    data: { ...productFieldData(f), ...(familyData ?? {}), images: { create: imagePaths.map((path, position) => ({ path, position })) } },
    select: { id: true },
  });
  // Every product has exactly one BASE unit (factor 1, = productUnitId) plus its optional pack units. Stock is kept in base units.
  // A stored barcode is optional and is only what the caller explicitly gave: a new product has no barcode unless one is entered
  // (POS and the product selectors find it by SKU meanwhile; a unit without a barcode just can't be printed or scanned).
  const base = baseBarcode ?? null;
  await tx.productUnitConversion.createMany({
    data: [
      { productId: p.id, unitId: f.productUnitId, factor: "1", isBase: true, active: true, forSales: true, forPurchases: true, barcode: base },
      ...units.map((u) => ({ productId: p.id, unitId: u.unitId, factor: u.factor, isBase: false, active: u.active, forSales: u.forSales, forPurchases: u.forPurchases, barcode: u.barcode ? u.barcode : null })),
    ],
  });
  // The SKU and every stored barcode enter the global identifier registry in this same transaction (unique: the final concurrency guard).
  await syncProductIdentifiers(tx, p.id);
  if (stock) {
    // Entries are immutable source records: created here, never updated or deleted.
    await tx.productStockEntry.create({
      // unitCost = this product's cost per base unit AT THIS MOMENT (immutable snapshot, the cost basis Profit & Loss uses).
      data: { productId: p.id, warehouseId: stock.warehouseId, quantity: stock.quantity, unitCost: f.cost, status: stock.status, source: stock.source, supplierId: stock.supplierId, createdById: userId },
    });
    if (stock.status === "RECEIVED") {
      await tx.productStock.upsert({
        where: { productId_warehouseId: { productId: p.id, warehouseId: stock.warehouseId } },
        create: { productId: p.id, warehouseId: stock.warehouseId, quantity: stock.quantity },
        update: { quantity: { increment: stock.quantity } },
      });
    }
  }
  return p;
}
