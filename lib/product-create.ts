import type { Prisma } from "@/app/generated/prisma/client";
import type { OpeningStock, ProductFields } from "@/lib/products";

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
 * Creates the product, its image rows, and (when given) exactly one opening-stock entry recorded with
 * who created it. Only RECEIVED stock is on hand: PENDING / ORDERED entries don't change "In Stock".
 */
export async function createProductRecord(
  tx: Prisma.TransactionClient,
  f: ProductFields,
  stock: OpeningStock | null,
  userId: string,
  imagePaths: string[] = [],
): Promise<{ id: string }> {
  const p = await tx.product.create({
    data: { ...productFieldData(f), images: { create: imagePaths.map((path, position) => ({ path, position })) } },
    select: { id: true },
  });
  if (stock) {
    await tx.productStockEntry.create({ data: { productId: p.id, ...stock, createdById: userId } });
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
