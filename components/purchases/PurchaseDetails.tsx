"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon, { type IconName } from "@/components/layout/Icon";
import Modal from "@/components/ui/Modal";
import { markPurchaseReceived } from "@/app/(dashboard)/purchases/actions";
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE, PURCHASE_STATUS_LABEL, PURCHASE_STATUS_TONE, type PaymentStatusValue, type PurchaseStatusValue } from "@/lib/purchases";

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

const L = ({ i, children }: { i: IconName; children: React.ReactNode }) => (
  <span>
    <Icon name={i} size={16} className="sp-icon" />
    {children}
  </span>
);

export default function PurchaseDetails({ purchase: p, supplier, company }: { purchase: Details; supplier: Party; company: Party }) {
  const router = useRouter();
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
        toast.error("Something went wrong. Please try again.", { id: "purchase" });
      }
    });
  }

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          Purchase Details
        </h1>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link href="/purchases" className="sp-btn sp-btn--secondary">
            <Icon name="arrow-left" size={18} />
            Back
          </Link>
          {receivable && (
            <button type="button" className="sp-btn sp-btn--primary" onClick={() => setConfirm(true)}>
              <Icon name="package-plus" size={18} />
              Mark as Received
            </button>
          )}
          {p.canReturn && (
            <Link href={`/purchases/returns/create?purchase=${encodeURIComponent(p.id)}`} className="sp-btn sp-btn--secondary">
              <Icon name="arrow-left-right" size={18} />
              Return Items
            </Link>
          )}
          {p.canPay && (
            <Link href={`/supplier-payments/record?purchase=${encodeURIComponent(p.id)}`} className="sp-btn sp-btn--secondary">
              <Icon name="wallet" size={18} />
              Record Payment
            </Link>
          )}
        </div>
      </div>

      <div className="sp-card" style={{ padding: 32 }} data-testid="purchase-details">
        <h2 className="t-section-title" style={{ textAlign: "center", margin: "0 0 24px" }}>
          Purchase Details : {p.reference}
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 24 }}>
          <div data-testid="supplier-info">
            <div className="sp-band">Supplier Info</div>
            <div className="sp-info">
              <L i="user">{supplier.name}</L>
              <L i="mail">{supplier.email}</L>
              <L i="smartphone">{supplier.phone}</L>
              <L i="map-pin">{supplier.address}</L>
            </div>
          </div>
          <div data-testid="company-info">
            <div className="sp-band">Company Info</div>
            <div className="sp-info">
              <L i="user">{company.name}</L>
              <L i="mail">{company.email}</L>
              <L i="smartphone">{company.phone}</L>
              <L i="map-pin">{company.address}</L>
            </div>
          </div>
          <div data-testid="purchase-info">
            <div className="sp-band">Purchase Info</div>
            <div className="sp-info">
              <span>
                Reference : <b style={{ fontWeight: 600 }}>{p.reference}</b>
              </span>
              <span>
                Status :{" "}
                <span className={`sp-badge sp-badge--${PURCHASE_STATUS_TONE[p.status]}`} data-status={p.status}>
                  <i />
                  {PURCHASE_STATUS_LABEL[p.status]}
                </span>
              </span>
              <span>
                Warehouse : <b style={{ fontWeight: 600 }}>{p.warehouse}</b>
              </span>
              <span>
                Date : <b style={{ fontWeight: 600 }}>{p.date}</b>
              </span>
              <span>
                Payment Status :{" "}
                <span className={`sp-badge sp-badge--${PAYMENT_STATUS_TONE[p.paymentStatus]}`} data-payment={p.paymentStatus}>
                  <i />
                  {PAYMENT_STATUS_LABEL[p.paymentStatus]}
                </span>
              </span>
              <span>
                Paid : <b style={{ fontWeight: 600 }}>{p.paid}</b> · Due : <b style={{ fontWeight: 600 }}>{p.due}</b>
              </span>
              {p.returns.length > 0 && (
                <span>
                  Returned : <b style={{ fontWeight: 600 }}>{p.returned}</b>
                </span>
              )}
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
            <span>Order Tax</span>
            <span>{p.orderTax}</span>
          </div>
          <div>
            <span>Discount</span>
            <span>{p.discount}</span>
          </div>
          <div>
            <span>Shipping</span>
            <span>{p.shipping}</span>
          </div>
          <div>
            <span>Grand Total</span>
            <span data-testid="details-grand">{p.grandTotal}</span>
          </div>
        </div>

        {p.returns.length > 0 && (
          <>
            <div className="sp-band" style={{ margin: "32px 0 16px" }}>
              Purchase Returns
            </div>
            <div className="sp-table-card" style={{ boxShadow: "none" }}>
              <table className="sp-table" data-testid="purchase-returns">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Date</th>
                    <th className="num">Grand Total</th>
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
              Supplier Payments
            </div>
            <div className="sp-table-card" style={{ boxShadow: "none" }}>
              <table className="sp-table" data-testid="purchase-payments">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Paid From</th>
                    <th className="num">Applied</th>
                  </tr>
                </thead>
                <tbody>
                  {p.payments.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <span className="sp-code">{r.reference}</span>
                      </td>
                      <td>{r.date}</td>
                      <td>{r.method}</td>
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
          <span>
            Created by {p.createdBy} · {p.createdOn}
          </span>
          {p.receivedOn ? <span>Stock received {p.receivedOn}</span> : <span>Stock not received yet — no quantities have been added to {p.warehouse}.</span>}
          {p.notes && <span>Notes: {p.notes}</span>}
        </div>
      </div>

      {confirm && (
        <Modal
          title={`Receive ${p.reference}?`}
          onClose={() => !pending && setConfirm(false)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setConfirm(false)} disabled={pending}>
                Cancel
              </button>
              <button type="button" className="sp-btn sp-btn--primary" onClick={receive} disabled={pending}>
                {pending ? "Saving…" : "Mark as Received"}
              </button>
            </>
          }
        >
          <p className="t-body" style={{ margin: 0, color: "var(--text-2)" }}>
            The ordered quantities will be added to the stock of {p.warehouse} now. This can only be done once.
          </p>
        </Modal>
      )}
    </>
  );
}
