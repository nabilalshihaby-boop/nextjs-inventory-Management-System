import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatQuantity } from "@/lib/money";
import { canManageProducts } from "@/lib/roles";
import { getProductFormData } from "@/lib/product-options";
import { getDict } from "@/lib/i18n/server";
import { conversionUsed, productHasActivity } from "@/lib/product-units";
import { skuLockedReason } from "@/lib/product-identifiers";
import { trimFactor } from "@/lib/unit-math";
import ProductForm from "@/components/products/ProductForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).products.editTitle };
}

export const instant = false;

// Edit Product (design/Create Product.html, pre-filled). OWNER/ADMIN only. The opening stock is
// shown read-only: stock isn't changed by editing (that belongs to Stock Adjustments).
export default async function EditProductPage({ params }: PageProps<"/products/[id]/edit">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageProducts(session.user)) redirect("/products");

  const { id } = await params;
  const p = await db.product.findUnique({
    where: { id },
    include: {
      images: { orderBy: { position: "asc" }, select: { id: true, path: true } },
      unitConversions: { orderBy: { createdAt: "asc" }, select: { unitId: true, factor: true, active: true, forSales: true, forPurchases: true, isBase: true, barcode: true } },
      stockEntries: { orderBy: { createdAt: "asc" }, take: 1, include: { warehouse: { select: { name: true } }, supplier: { select: { name: true } } } },
    },
  });
  if (!p) notFound();

  const data = await getProductFormData([p.productUnitId, p.saleUnitId, p.purchaseUnitId, ...p.unitConversions.map((c) => c.unitId)]);
  const entry = p.stockEntries[0];
  // Pack units + safety flags: a unit documents used keeps its factor; a product with any activity keeps its base unit.
  const unitRows = p.unitConversions.filter((c) => !c.isBase).map((c) => ({ unitId: c.unitId, factor: trimFactor(c.factor.toFixed(6)), active: c.active, forSales: c.forSales, forPurchases: c.forPurchases, barcode: c.barcode ?? "" }));
  const baseBarcode = p.unitConversions.find((c) => c.isBase)?.barcode ?? "";
  const usedUnits: Record<string, boolean> = {};
  for (const r of unitRows) usedUnits[r.unitId] = await conversionUsed(db, p.id, r.unitId, r.factor);
  const baseLocked = await productHasActivity(db, p.id);
  const skuLocked = (await skuLockedReason(db, p.id)) !== null;
  return (
    <ProductForm
      {...data}
      productId={p.id}
      initial={{
        name: p.name,
        code: p.code,
        categoryId: p.categoryId,
        brandId: p.brandId,
        barcodeSymbology: p.barcodeSymbology,
        cost: p.cost.toFixed(2),
        price: p.price.toFixed(2),
        productUnitId: p.productUnitId,
        saleUnitId: p.saleUnitId,
        purchaseUnitId: p.purchaseUnitId,
        stockAlert: formatQuantity(p.stockAlert.toFixed(3)).replace(/,/g, ""),
        orderTax: p.orderTax.toFixed(2).replace(/\.00$/, ""),
        taxType: p.taxType,
        quantityLimitation: p.quantityLimitation ? formatQuantity(p.quantityLimitation.toFixed(3)).replace(/,/g, "") : "",
        notes: p.notes ?? "",
        warehouseId: "",
        supplierId: "",
        quantity: "",
        status: "",
      }}
      images={p.images}
      unitRows={unitRows}
      baseBarcode={baseBarcode}
      usedUnits={usedUnits}
      baseLocked={baseLocked}
      skuLocked={skuLocked}
      familyInitial={{ familyId: p.familyId ?? "", values: [p.variantValue1 ?? "", p.variantValue2 ?? "", p.variantValue3 ?? ""] }}
      openingStock={
        entry
          ? { warehouse: entry.warehouse.name, supplier: entry.supplier?.name ?? null, quantity: formatQuantity(entry.quantity.toFixed(3)), status: entry.status }
          : null
      }
    />
  );
}
