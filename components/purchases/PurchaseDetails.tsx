"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon, { type IconName } from "@/components/layout/Icon";
import Modal from "@/components/ui/Modal";
import { markPurchaseReceived } from "@/app/(dashboard)/purchases/actions";
import { PAYMENT_STATUS_TONE, PURCHASE_STATUS_TONE, type PaymentStatusValue, type PurchaseStatusValue } from "@/lib/purchases";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";

// Port of design/Purchase Details.html: PageHeader (+ Back), card with "Purchase Details : <ref>",
// Supplier Info / Company Info / Purchase Info bands, Order Summary table and the totals summary.
// Added: "Mark as Received" for Pending/Ordered purchases (adds stock exactly once, confirmed first).

type Details = {
  id: string;
  reference: string;
  status: PurchaseStatusValue;
  date: string;
  warehouse: string;
  createdBy: string;
  createdOn: string;
  receivedOn: string | null;
  notes: string;
  paymentStatus: PaymentStatusValue;
  paid: string;
  /** Σ completed purchase returns (reduces the due). */
  returned: string;
  due: string;
  canReturn: boolean;
  returns: { id: string; reference: string; date: string; total: string }[];
  /** Due > 0 → a supplier payment can be recorded against it. */
  canPay: boolean;
  payments: { id: string; reference: string; date: string; method: string; account: string; amount: string }[];
  orderTax: string;
  discount: string;
  shipping: string;
  grandTotal: string;
  items: { id: string; product: string; netUnitCost: string; quantity: string; unitCost: string; discount: string; tax: string; subtotal: string }[];
};
type Party = { name: string; email: string; phone: string; address: string };

// `d`: ltr for emails/phones, auto for names/addresses (keeps them readable inside Arabic pages).
const L = ({ i, d = "auto", children }: { i: IconName; d?: "ltr" | "auto"; children: React.ReactNode }) => (
  <span>
    <Icon name={i} size={16} className="sp-icon" />
    <bdi dir={d}>{children}</bdi>
  </span>
);

export default function PurchaseDetails({ purchase: p, supplier, company }: { purchase: Details; supplier: Party; company: Party }) {
  const router = useRouter();
  const T = useT();
  const D = T.purchases.details;
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();
  const receivable = p.status !== "RECEIVED";

  function receive() {
    startTransition(async () => {
      try {
        const r = await markPurchaseReceived(p.id);
        setConfirm(false);
        if (!r.ok) toast.error(r.message, { id: "purchase" });
        else toast.success(r.message, { id: "purchase" });
        router.refresh();
      } catch {
        toast.error(T.common.somethingWrong, { id: "purchase" });
      }
    });
  }

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {D.title}
        </h1>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link href="/purchases" className="sp-btn sp-btn--secondary">
            <Icon name="arrow-left" size={18} />
            {D.back}
          </Link>
          {receivable && (
            <button type="button" className="sp-btn sp-btn--primary" onClick={() => setConfirm(true)}>
              <Icon name="package-plus" size={18} />
              {D.markReceived}
            </button>
          )}
          {p.canReturn && (
            <Link href={`/purchases/returns/create?purchase=${encodeURIComponent(p.id)}`} className="sp-btn sp-btn--secondary">
              <Icon name="arrow-left-right" size={18} />
              {D.returnItems}
            </Link>
          )}
          {p.canPay && (
            <Link href={`/supplier-payments/record?purchase=${encodeURIComponent(p.id)}`} className="sp-btn sp-btn--secondary">
              <Icon name="wallet" size={18} />
              {D.recordPayment}
            </Link>
          )}
        </div>
      </div>

      <div className="sp-card" style={{ padding: 32 }} data-testid="purchase-details">
        <h2 className="t-section-title" style={{ textAlign: "center", margin: "0 0 24px" }}>
          {fmt(D.headline, { ref: p.reference })}
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 24 }}>
          <div data-testid="supplier-info">
            <div className="sp-band">{D.supplierInfo}</div>
            <div className="sp-info">
              <L i="user">{supplier.name}</L>
              <L i="mail" d="ltr">{supplier.email}</L>
              <L i="smartphone" d="ltr">{supplier.phone}</L>
              <L i="map-pin">{supplier.address}</L>
            </div>
          </div>
          <div data-testid="company-info">
            <div className="sp-band">{D.companyInfo}</div>
            <div className="sp-info">
              <L i="user">{company.name}</L>
              <L i="mail" d="ltr">{company.email}</L>
              <L i="smartphone" d="ltr">{company.phone}</L>
              <L i="map-pin">{company.address}</L>
            </div>
          </div>
          <div data-testid="purchase-info">
            <div className="sp-band">{D.purchaseInfo}</div>
            <div className="sp-info">
              <span>
                {D.reference} : <b style={{ fontWeight: 600 }} dir="ltr">{p.reference}</b>
              </span>
              <span>
                {D.status} :{" "}
                <span className={`sp-badge sp-badge--${PURCHASE_STATUS_TONE[p.status]}`} data-status={p.status}>
                  <i />
                  {T.purchases.status[p.status]}
                </span>
              </span>
              <span>
                {D.warehouse} : <b style={{ fontWeight: 600 }}>{p.warehouse}</b>
              </span>
              <span>
                {D.date} : <b style={{ fontWeight: 600 }}>{p.date}</b>
              </span>
              <span>
                {D.paymentStatus} :{" "}
                <span className={`sp-badge sp-badge--${PAYMENT_STATUS_TONE[p.paymentStatus]}`} data-payment={p.paymentStatus}>
                  <i />
                  {T.sales.payStatus[p.paymentStatus]}
                </span>
              </span>
              <span>
                {D.paid} : <b style={{ fontWeight: 600 }}>{p.paid}</b> · {D.due} : <b style={{ fontWeight: 600 }}>{p.due}</b>
              </span>
              {p.returns.length > 0 && (
                <span>
                  {D.returned} : <b style={{ fontWeight: 600 }}>{p.returned}</b>
                </span>
              )}
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
                {p.items.map((i) => (
                  <tr key={i.id}>
                    <td className="primary-cell">{i.product}</td>
                    <td className="num">{i.netUnitCost}</td>
                    <td className="num">{i.quantity}</td>
                    <td className="num">{i.unitCost}</td>
                    <td className="num">{i.discount}</td>
                    <td className="num">{i.tax}</td>
                    <td className="num">{i.subtotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="sp-sum" style={{ marginTop: 32 }} data-testid="details-summary">
          <div>
            <span>{D.orderTax}</span>
            <span>{p.orderTax}</span>
          </div>
          <div>
            <span>{D.discount}</span>
            <span>{p.discount}</span>
          </div>
          <div>
            <span>{D.shipping}</span>
            <span>{p.shipping}</span>
          </div>
          <div>
            <span>{D.grandTotal}</span>
            <span data-testid="details-grand">{p.grandTotal}</span>
          </div>
        </div>

        {p.returns.length > 0 && (
          <>
            <div className="sp-band" style={{ margin: "32px 0 16px" }}>
              {D.purchaseReturns}
            </div>
            <div className="sp-table-card" style={{ boxShadow: "none" }}>
              <table className="sp-table" data-testid="purchase-returns">
                <thead>
                  <tr>
                    <th>{D.colReference}</th>
                    <th>{D.colDate}</th>
                    <th className="num">{D.grandTotal}</th>
                  </tr>
                </thead>
                <tbody>
                  {p.returns.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/purchases/returns/${encodeURIComponent(r.id)}`} className="sp-code">
                          {r.reference}
                        </Link>
                      </td>
                      <td>{r.date}</td>
                      <td className="num">{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {p.payments.length > 0 && (
          <>
            <div className="sp-band" style={{ margin: "32px 0 16px" }}>
              {D.supplierPayments}
            </div>
            <div className="sp-table-card" style={{ boxShadow: "none" }}>
              <table className="sp-table" data-testid="purchase-payments">
                <thead>
                  <tr>
                    <th>{D.colReference}</th>
                    <th>{D.colDate}</th>
                    <th>{D.colMethod}</th>
                    <th>{D.colPaidFrom}</th>
                    <th className="num">{D.colApplied}</th>
                  </tr>
                </thead>
                <tbody>
                  {p.payments.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <span className="sp-code">{r.reference}</span>
                      </td>
                      <td>{r.date}</td>
                      <td>{(T.sales.methods as Record<string, string>)[r.method] ?? r.method}</td>
                      <td>{r.account}</td>
                      <td className="num">{r.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="t-caption" style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 4 }}>
          <span>{fmt(D.createdBy, { by: p.createdBy, on: p.createdOn })}</span>
          {p.receivedOn ? <span>{fmt(D.receivedLine, { on: p.receivedOn })}</span> : <span>{fmt(D.notReceived, { warehouse: p.warehouse })}</span>}
          {p.notes && <span>{fmt(D.notesLine, { notes: p.notes })}</span>}
        </div>
      </div>

      {confirm && (
        <Modal
          title={fmt(D.confirmTitle, { ref: p.reference })}
          onClose={() => !pending && setConfirm(false)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setConfirm(false)} disabled={pending}>
                {D.cancel}
              </button>
              <button type="button" className="sp-btn sp-btn--primary" onClick={receive} disabled={pending}>
                {pending ? D.saving : D.markReceived}
              </button>
            </>
          }
        >
          <p className="t-body" style={{ margin: 0, color: "var(--text-2)" }}>
            {fmt(D.confirmBody, { warehouse: p.warehouse })}
          </p>
        </Modal>
      )}
    </>
  );
}
