import { recordOutOfScope } from "@/lib/access-scope";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getCountryOptions } from "@/lib/countries";
import { formatDateOnly, formatDateTime } from "@/lib/format";
import { formatMoney, formatQuantity } from "@/lib/money";
import { canViewPurchaseReturns, canViewPurchases } from "@/lib/roles";
import { getSystemSettings } from "@/lib/settings";
import Icon, { type IconName } from "@/components/layout/Icon";
import { getDict, getLocaleInfo } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).purchaseReturns.details.title };
}

export const instant = false;

// Purchase Return details — the design's list links "View Purchases Return" to Purchase
// Details.html, so this reuses that layout (Supplier / Company / Return Info bands, Order Summary,
// totals). Read-only: returns are immutable. OWNER/ADMIN only.
const L = ({ i, d = "auto", children }: { i: IconName; d?: "ltr" | "auto"; children: React.ReactNode }) => (
  <span>
    <Icon name={i} size={16} className="sp-icon" />
    <bdi dir={d}>{children}</bdi>
  </span>
);

export default async function PurchaseReturnDetailsPage({ params }: PageProps<"/purchases/returns/[id]">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canViewPurchaseReturns(session.user)) redirect("/dashboard");
  const viewPurchase = canViewPurchases(session.user);

  const { id } = await params;
  const { locale, dict: T } = await getLocaleInfo();
  const D = T.purchaseReturns.details;
  if (await recordOutOfScope("purchaseReturn", id)) notFound();
  const r = await db.purchaseReturn.findUnique({
    where: { id },
    include: {
      supplier: true,
      warehouse: { select: { name: true } },
      currency: { select: { code: true, symbol: true } },
      purchase: { select: { id: true, reference: true } },
      items: { orderBy: { id: "asc" }, include: { product: { select: { code: true, name: true, purchaseUnit: { select: { name: true } } } } } },
    },
  });
  if (!r) notFound();
  const settings = await getSystemSettings();
  const cur = { code: r.currency.code, symbol: r.currency.symbol, right: !!settings?.currencyIconRight };
  const m = (v: { toFixed: (n: number) => string }) => formatMoney(v.toFixed(2), cur);
  const country = new Map<string, string>(getCountryOptions(locale).map((c) => [c.code, c.name]));
  const creator = r.createdById ? await db.user.findUnique({ where: { id: r.createdById }, select: { firstName: true, lastName: true } }) : null;
  const company = [settings?.address, settings?.city, settings?.state, settings?.country ? (country.get(settings.country) ?? settings.country) : ""].filter(Boolean).join(", ");

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {D.title}
        </h1>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link href="/purchases/returns" className="sp-btn sp-btn--secondary">
            <Icon name="arrow-left" size={18} />
            {D.back}
          </Link>
          {viewPurchase && (
            <Link href={`/purchases/${encodeURIComponent(r.purchase.id)}`} className="sp-btn sp-btn--secondary">
            <Icon name="eye" size={18} />
            {fmt(D.viewPurchase, { ref: r.purchase.reference })}
          </Link>
          )}
        </div>
      </div>

      <div className="sp-card" style={{ padding: 32 }} data-testid="return-details">
        <h2 className="t-section-title" style={{ textAlign: "center", margin: "0 0 24px" }}>
          {fmt(D.headline, { ref: r.reference })}
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 24 }}>
          <div data-testid="supplier-info">
            <div className="sp-band">{D.supplierInfo}</div>
            <div className="sp-info">
              <L i="user">{r.supplier.name}</L>
              <L i="mail" d="ltr">{r.supplier.email}</L>
              <L i="smartphone" d="ltr">{r.supplier.phoneNumber}</L>
              <L i="map-pin">{[r.supplier.address, r.supplier.city, country.get(r.supplier.countryCode) ?? r.supplier.countryCode].filter(Boolean).join(", ")}</L>
            </div>
          </div>
          <div data-testid="company-info">
            <div className="sp-band">{D.companyInfo}</div>
            <div className="sp-info">
              <L i="user">{settings?.companyName || "—"}</L>
              <L i="mail" d="ltr">{settings?.defaultEmail || "—"}</L>
              <L i="smartphone" d="ltr">{settings?.companyPhone || "—"}</L>
              <L i="map-pin">{company || "—"}</L>
            </div>
          </div>
          <div data-testid="return-info">
            <div className="sp-band">{D.returnInfo}</div>
            <div className="sp-info">
              <span>
                {D.reference} : <b style={{ fontWeight: 600 }} dir="ltr">{r.reference}</b>
              </span>
              <span>
                {D.purchase} :{" "}
                {viewPurchase ? (
                  <Link href={`/purchases/${encodeURIComponent(r.purchase.id)}`} style={{ fontWeight: 600 }}>
                    {r.purchase.reference}
                  </Link>
                ) : (
                  <b style={{ fontWeight: 600 }} dir="ltr">{r.purchase.reference}</b>
                )}
              </span>
              <span>
                {D.status} :{" "}
                <span className="sp-badge sp-badge--success">
                  <i />
                  {D.completed}
                </span>
              </span>
              <span>
                {D.warehouse} : <b style={{ fontWeight: 600 }}>{r.warehouse.name}</b>
              </span>
              <span>
                {D.date} : <b style={{ fontWeight: 600 }}>{formatDateOnly(r.returnDate, settings?.dateFormat)}</b>
              </span>
            </div>
          </div>
        </div>

        <div className="sp-band" style={{ margin: "32px 0 16px" }}>
          {D.orderSummary}
        </div>
        <div className="sp-table-card" style={{ boxShadow: "none" }}>
          <div className="sp-table-scroll">
            <table className="sp-table" data-testid="order-summary">
              <thead>
                <tr>
                  <th>{D.colProduct}</th>
                  <th className="num">{D.colNet}</th>
                  <th className="num">{D.colQuantity}</th>
                  <th className="num">{D.colUnitCost}</th>
                  <th className="num">{D.colDiscount}</th>
                  <th className="num">{D.colTax}</th>
                  <th className="num">{D.colSubtotal}</th>
                </tr>
              </thead>
              <tbody>
                {r.items.map((i) => (
                  <tr key={i.id}>
                    <td className="primary-cell">
                      {i.product.code} ({i.product.name})
                    </td>
                    <td className="num">{m(i.netUnitCost)}</td>
                    <td className="num">
                      {formatQuantity(i.quantity.toFixed(3))} {i.unitName ?? i.product.purchaseUnit.name}
                    </td>
                    <td className="num">{m(i.unitCost)}</td>
                    <td className="num">{m(i.discountAmount)}</td>
                    <td className="num">{m(i.taxAmount)}</td>
                    <td className="num">{m(i.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="sp-sum" style={{ marginTop: 32 }} data-testid="details-summary">
          <div>
            <span>{D.orderTax}</span>
            <span>{m(r.orderTaxAmount)}</span>
          </div>
          <div>
            <span>{D.discount}</span>
            <span>{m(r.discount)}</span>
          </div>
          <div>
            <span>{D.shipping}</span>
            <span>{m(r.shipping)}</span>
          </div>
          <div>
            <span>{D.grandTotal}</span>
            <span data-testid="details-grand">{m(r.grandTotal)}</span>
          </div>
        </div>

        <div className="t-caption" style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 4 }}>
          <span>{fmt(D.createdBy, { by: creator ? `${creator.firstName} ${creator.lastName}` : "—", on: formatDateTime(r.createdAt, settings?.dateFormat, locale) })}</span>
          <span>{fmt(D.note, { warehouse: r.warehouse.name, purchase: r.purchase.reference })}</span>
          {r.notes && <span>{fmt(D.reason, { notes: r.notes })}</span>}
        </div>
      </div>
    </>
  );
}
