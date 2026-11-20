import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getCountryOptions } from "@/lib/countries";
import { formatDateOnly, formatDateTime } from "@/lib/format";
import { formatMoney, formatQuantity } from "@/lib/money";
import { canManagePurchaseReturns } from "@/lib/roles";
import { getSystemSettings } from "@/lib/settings";
import Icon, { type IconName } from "@/components/layout/Icon";

export const metadata: Metadata = { title: "Purchase Return Details" };

export const instant = false;

// Purchase Return details — the design's list links "View Purchases Return" to Purchase
// Details.html, so this reuses that layout (Supplier / Company / Return Info bands, Order Summary,
// totals). Read-only: returns are immutable. OWNER/ADMIN only.
const L = ({ i, children }: { i: IconName; children: React.ReactNode }) => (
  <span>
    <Icon name={i} size={16} className="sp-icon" />
    {children}
  </span>
);

export default async function PurchaseReturnDetailsPage({ params }: PageProps<"/purchases/returns/[id]">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManagePurchaseReturns(session.user.role)) redirect("/dashboard");

  const { id } = await params;
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
  const country = new Map<string, string>(getCountryOptions().map((c) => [c.code, c.name]));
  const creator = r.createdById ? await db.user.findUnique({ where: { id: r.createdById }, select: { firstName: true, lastName: true } }) : null;
  const company = [settings?.address, settings?.city, settings?.state, settings?.country ? (country.get(settings.country) ?? settings.country) : ""].filter(Boolean).join(", ");

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          Purchase Return Details
        </h1>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link href="/purchases/returns" className="sp-btn sp-btn--secondary">
            <Icon name="arrow-left" size={18} />
            Back
          </Link>
          <Link href={`/purchases/${encodeURIComponent(r.purchase.id)}`} className="sp-btn sp-btn--secondary">
            <Icon name="eye" size={18} />
            View {r.purchase.reference}
          </Link>
        </div>
      </div>

      <div className="sp-card" style={{ padding: 32 }} data-testid="return-details">
        <h2 className="t-section-title" style={{ textAlign: "center", margin: "0 0 24px" }}>
          Purchase Return Details : {r.reference}
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 24 }}>
          <div data-testid="supplier-info">
            <div className="sp-band">Supplier Info</div>
            <div className="sp-info">
              <L i="user">{r.supplier.name}</L>
              <L i="mail">{r.supplier.email}</L>
              <L i="smartphone">{r.supplier.phoneNumber}</L>
              <L i="map-pin">{[r.supplier.address, r.supplier.city, country.get(r.supplier.countryCode) ?? r.supplier.countryCode].filter(Boolean).join(", ")}</L>
            </div>
          </div>
          <div data-testid="company-info">
            <div className="sp-band">Company Info</div>
            <div className="sp-info">
              <L i="user">{settings?.companyName || "—"}</L>
              <L i="mail">{settings?.defaultEmail || "—"}</L>
              <L i="smartphone">{settings?.companyPhone || "—"}</L>
              <L i="map-pin">{company || "—"}</L>
            </div>
          </div>
          <div data-testid="return-info">
            <div className="sp-band">Return Info</div>
            <div className="sp-info">
              <span>
                Reference : <b style={{ fontWeight: 600 }}>{r.reference}</b>
              </span>
              <span>
                Purchase :{" "}
                <Link href={`/purchases/${encodeURIComponent(r.purchase.id)}`} style={{ fontWeight: 600 }}>
                  {r.purchase.reference}
                </Link>
              </span>
              <span>
                Status :{" "}
                <span className="sp-badge sp-badge--success">
                  <i />
                  Completed
                </span>
              </span>
              <span>
                Warehouse : <b style={{ fontWeight: 600 }}>{r.warehouse.name}</b>
              </span>
              <span>
                Date : <b style={{ fontWeight: 600 }}>{formatDateOnly(r.returnDate, settings?.dateFormat)}</b>
              </span>
            </div>
          </div>
        </div>

        <div className="sp-band" style={{ margin: "32px 0 16px" }}>
          Order Summary
        </div>
        <div className="sp-table-card" style={{ boxShadow: "none" }}>
          <div className="sp-table-scroll">
            <table className="sp-table" data-testid="order-summary">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Net Unit Cost</th>
                  <th className="num">Quantity</th>
                  <th className="num">Unit Cost</th>
                  <th className="num">Discount</th>
                  <th className="num">Tax</th>
                  <th className="num">Subtotal</th>
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
                      {formatQuantity(i.quantity.toFixed(3))} {i.product.purchaseUnit.name}
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
            <span>Order Tax</span>
            <span>{m(r.orderTaxAmount)}</span>
          </div>
          <div>
            <span>Discount</span>
            <span>{m(r.discount)}</span>
          </div>
          <div>
            <span>Shipping</span>
            <span>{m(r.shipping)}</span>
          </div>
          <div>
            <span>Grand Total</span>
            <span data-testid="details-grand">{m(r.grandTotal)}</span>
          </div>
        </div>

        <div className="t-caption" style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 4 }}>
          <span>
            Created by {creator ? `${creator.firstName} ${creator.lastName}` : "—"} · {formatDateTime(r.createdAt, settings?.dateFormat)}
          </span>
          <span>
            The returned quantities were deducted from {r.warehouse.name}, and this amount reduced the due of {r.purchase.reference}. Order tax and discount are shared out from the original purchase; shipping is not returned. No cash/bank movement was recorded.
          </span>
          {r.notes && <span>Reason / notes: {r.notes}</span>}
        </div>
      </div>
    </>
  );
}
