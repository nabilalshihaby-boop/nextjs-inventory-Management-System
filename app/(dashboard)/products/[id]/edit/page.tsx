import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatQuantity } from "@/lib/money";
import { canManageProducts } from "@/lib/roles";
import { getProductFormData } from "@/lib/product-options";
import ProductForm from "@/components/products/ProductForm";

export const metadata: Metadata = { title: "Edit Product" };

export const instant = false;

// Edit Product (design/Create Product.html, pre-filled). OWNER/ADMIN only. The opening stock is
// shown read-only: stock isn't changed by editing (that belongs to Stock Adjustments).
export default async function EditProductPage({ params }: PageProps<"/products/[id]/edit">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageProducts(session.user.role)) redirect("/products");

  const { id } = await params;
  const p = await db.product.findUnique({
    where: { id },
    include: {
      images: { orderBy: { position: "asc" }, select: { id: true, path: true } },
      stockEntries: { orderBy: { createdAt: "asc" }, take: 1, include: { warehouse: { select: { name: true } }, supplier: { select: { name: true } } } },
    },
  });
  if (!p) notFound();

  const data = await getProductFormData();
  const entry = p.stockEntries[0];
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
      openingStock={
        entry
          ? { warehouse: entry.warehouse.name, supplier: entry.supplier.name, quantity: formatQuantity(entry.quantity.toFixed(3)), status: entry.status }
          : null
      }
    />
  );
}
