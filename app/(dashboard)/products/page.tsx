import { warehouseIdFilter } from "@/lib/access-scope";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { getLocaleInfo } from "@/lib/i18n/server";
import { formatMoney, formatQuantity } from "@/lib/money";
import { canManageProducts } from "@/lib/roles";
import { getDefaultCurrency, getSystemSettings } from "@/lib/settings";
import ProductsTable from "@/components/products/ProductsTable";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLocaleInfo()).dict.products.title };
}

export const instant = false;

// Products list (design/Products.html). Every signed-in role may view/search; only OWNER/ADMIN get
// Create / Edit (and the Server Actions re-check that). Cost and supplier are never sent here.
export default async function ProductsPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const { locale } = await getLocaleInfo();
  const [products, stockSums, settings, currency] = await Promise.all([
    db.product.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        code: true,
        price: true,
        stockAlert: true,
        createdAt: true,
        brand: { select: { name: true } },
        productUnit: { select: { name: true } },
        images: { orderBy: { position: "asc" }, take: 1, select: { path: true } },
      },
    }),
    // "In Stock" = on-hand quantity summed over all warehouses (ProductStock only).
    db.productStock.groupBy({ by: ["productId"], where: await warehouseIdFilter(), _sum: { quantity: true } }),
    getSystemSettings(),
    getDefaultCurrency(),
  ]);
  const onHand = new Map(stockSums.map((s) => [s.productId, s._sum.quantity]));

  const rows = products.map((p) => {
    const qty = onHand.get(p.id);
    const qtyStr = qty ? qty.toFixed(3) : "0.000";
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      brand: p.brand.name,
      price: formatMoney(p.price.toFixed(2), currency),
      unit: p.productUnit.name,
      inStock: formatQuantity(qtyStr),
      lowStock: !qty || qty.lte(p.stockAlert), // Decimal comparison (no floats)
      image: p.images[0]?.path ?? null,
      createdOn: formatDateTime(p.createdAt, settings?.dateFormat, locale),
    };
  });

  return <ProductsTable rows={rows} canManage={canManageProducts(session.user)} />;
}
