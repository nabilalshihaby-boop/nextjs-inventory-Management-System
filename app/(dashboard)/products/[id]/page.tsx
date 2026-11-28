import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { warehouseIdFilter } from "@/lib/access-scope";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { describeVariant, dimensionsOf, valuesOf, effectiveHsCode } from "@/lib/family-core";
import { fmt } from "@/lib/i18n/config";
import { getLocaleInfo } from "@/lib/i18n/server";
import { formatMoney, formatQuantity } from "@/lib/money";
import { canManageProducts } from "@/lib/roles";
import { getDefaultCurrency, getSystemSettings } from "@/lib/settings";
import { trimFactor } from "@/lib/unit-math";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const p = await db.product.findUnique({ where: { id }, select: { name: true } });
  return { title: p?.name ?? (await getLocaleInfo()).dict.products.title };
}

export const instant = false;

// Read-only product details, for every signed-in role that can see the Products list (the same access as the list). It never shows cost,
// supplier or opening-stock details. Inactive products stay viewable here (their history is intact). Stock is limited to the user's warehouses.
export default async function ProductDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const { id } = await params;
  const { locale, dict: T } = await getLocaleInfo();
  const p = await db.product.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      code: true,
      active: true,
      price: true,
      createdAt: true,
      handle: true,
      hsCode: true,
      brand: { select: { name: true } },
      category: { select: { name: true } },
      productUnit: { select: { name: true } },
      family: { select: { name: true, handle: true, hsCode: true, dimension1: true, dimension2: true, dimension3: true } },
      variantValue1: true,
      variantValue2: true,
      variantValue3: true,
      unitConversions: { where: { isBase: false }, orderBy: { createdAt: "asc" }, select: { factor: true, active: true, unit: { select: { name: true } } } },
    },
  });
  if (!p) notFound();
  const [stock, settings, currency] = await Promise.all([
    db.productStock.aggregate({ where: { productId: p.id, ...(await warehouseIdFilter()) }, _sum: { quantity: true } }),
    getSystemSettings(),
    getDefaultCurrency(),
  ]);
  const L = T.products.list;
  const S = T.products.status;
  const rows: [string, React.ReactNode][] = [
    [L.colCode, <bdi key="c" dir="ltr">{p.code}</bdi>],
    [T.products.labels.category, p.category.name],
    [L.colBrand, p.brand.name],
    [L.colPrice, <bdi key="p" dir="ltr">{formatMoney(p.price.toFixed(2), currency)}</bdi>],
    [L.colUnit, p.productUnit.name],
    [L.colStock, <bdi key="s" dir="ltr">{formatQuantity(stock._sum.quantity ? stock._sum.quantity.toFixed(3) : "0.000")}</bdi>],
    [L.colCreated, formatDateTime(p.createdAt, settings?.dateFormat, locale)],
  ];
  if (p.family) rows.splice(1, 0, [p.family.name, describeVariant(dimensionsOf(p.family), valuesOf(p))]);
  const handle = p.family ? p.family.handle : p.handle; // a family member is sold under its family's handle
  if (handle) rows.push([T.importExport.identity.handle, <bdi key="h" dir="ltr" data-testid="product-handle">{handle}</bdi>]);
  const hs = effectiveHsCode(p.hsCode, p.family?.hsCode);
  if (hs)
    rows.push([
      T.importExport.identity.hsCode,
      <span key="hs">
        <bdi dir="ltr" data-testid="product-hscode">{hs}</bdi>
        {p.family && !p.hsCode ? <span className="sp-hint" data-testid="product-hscode-source"> ({T.importExport.identity.fromGroup})</span> : null}
      </span>,
    ]);

  return (
    <div className="sp-card" style={{ padding: 24, display: "grid", gap: 16, maxWidth: 720 }} data-testid="product-details">
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 className="t-section-title" style={{ margin: 0 }}>{p.name}</h2>
        <span className={"sp-badge " + (p.active ? "sp-badge--success" : "sp-badge--neutral")} data-testid="product-status">
          {p.active ? S.active : S.inactive}
        </span>
      </div>
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "8px 24px", margin: 0 }}>
        {rows.map(([k, v], i) => (
          <div key={i} style={{ display: "contents" }}>
            <dt style={{ color: "var(--text-2)" }}>{k}</dt>
            <dd style={{ margin: 0 }}>{v}</dd>
          </div>
        ))}
      </dl>
      {p.unitConversions.length > 0 && (
        <div>
          <b>{T.units.form.title}</b>
          <ul style={{ margin: "6px 0 0", paddingInlineStart: 20 }}>
            {p.unitConversions.map((c) => (
              <li key={c.unit.name} style={c.active ? undefined : { color: "var(--text-3)" }}>
                <bdi dir="ltr">{fmt(T.units.form.meaning, { unit: c.unit.name, factor: trimFactor(c.factor.toFixed(6)), base: p.productUnit.name })}</bdi>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/products" className="sp-btn sp-btn--secondary sp-btn--sm">
          {T.products.status.backToList}
        </Link>
        {canManageProducts(session.user) && (
          <Link href={`/products/${encodeURIComponent(p.id)}/edit`} className="sp-btn sp-btn--primary sp-btn--sm">
            {S.edit}
          </Link>
        )}
      </div>
    </div>
  );
}
