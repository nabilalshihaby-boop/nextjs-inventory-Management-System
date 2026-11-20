"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon, { type IconName } from "@/components/layout/Icon";
import Modal, { ConfirmDeleteModal } from "@/components/ui/Modal";
import { completeSale, deleteSale } from "@/app/(dashboard)/sales/actions";
import { PAYMENTS_SOON, SALE_PDF_SOON, SALE_RETURN_SOON, SALE_STATUS_LABEL, SALE_STATUS_TONE, type SaleStatusValue } from "@/lib/sales";

// Port of design/Sale Details.html: PageHeader (+ Back), card with "Sale Details : <ref>", Customer
// Info / Company Info / Invoice Info bands (Reference, Status, Warehouse, Payment Status), Order
// Summary table and the totals summary. Added for the real lifecycle: Pending → "Mark as Completed"
// (confirmed; the server deducts stock exactly once or refuses), Edit and Delete while Pending.
// Completed sales are read-only. Deferred (disabled with a reason): Show Payments, Create Sale
// Return, Download PDF. Paid is 0 and Due = Grand Total until customer payments exist.

type Details = {
  id: string;
  reference: string;
  status: SaleStatusValue;
  date: string;
  warehouse: string;
  createdBy: string;
  createdOn: string;
  completedOn: string | null;
  quotation: { id: string; reference: string } | null;
  notes: string;
  paid: string;
  due: string;
  orderTax: string;
  discount: string;
  shipping: string;
  grandTotal: string;
  items: { id: string; product: string; netUnitPrice: string; quantity: string; unitPrice: string; discount: string; tax: string; subtotal: string }[];
};
type Party = { name: string; email: string; phone: string; address: string };

const L = ({ i, children }: { i: IconName; children: ReactNode }) => (
  <span>
    <Icon name={i} size={16} className="sp-icon" />
    {children}
  </span>
);

export default function SaleDetails({ sale: s, customer, company }: { sale: Details; customer: Party; company: Party }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [del, setDel] = useState(false);
  const [pending, startTransition] = useTransition();
  const open = s.status === "PENDING";

  function complete() {
    startTransition(async () => {
      try {
        const r = await completeSale(s.id);
        setConfirm(false);
        if (!r.ok) toast.error(r.message, { id: "sale", duration: 7000 });
        else toast.success(r.message, { id: "sale" });
        router.refresh();
      } catch {
        toast.error("Something went wrong. Please try again.", { id: "sale" });
      }
    });
  }
  function remove() {
    startTransition(async () => {
      try {
        const r = await deleteSale(s.id);
        setDel(false);
        if (!r.ok) {
          toast.error(r.message, { id: "sale" });
          return void router.refresh();
        }
        toast.success(r.message, { id: "sale" });
        router.push("/sales");
        router.refresh();
      } catch {
        toast.error("Something went wrong. Please try again.", { id: "sale" });
      }
    });
  }
  const soon = (label: string, icon: IconName, why: string) => (
    <button type="button" className="sp-btn sp-btn--secondary" aria-disabled="true" title={why} aria-label={`${label} (${why})`} style={{ opacity: 0.5, cursor: "not-allowed" }} onClick={() => toast(why, { id: "sale-soon", icon: "ℹ️" })}>
      <Icon name={icon} size={18} />
      {label}
    </button>
  );

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          Sale Details
        </h1>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }} data-testid="sale-actions">
          <Link href="/sales" className="sp-btn sp-btn--secondary">
            <Icon name="arrow-left" size={18} />
            Back
          </Link>
          {open && (
            <Link href={`/sales/${encodeURIComponent(s.id)}/edit`} className="sp-btn sp-btn--secondary">
              <Icon name="pencil" size={18} />
              Edit
            </Link>
          )}
          {open && (
            <button type="button" className="sp-btn sp-btn--primary" onClick={() => setConfirm(true)} disabled={pending}>
              <Icon name="circle-check" size={18} />
              Mark as Completed
            </button>
          )}
          {soon("Show Payments", "dollar-sign", PAYMENTS_SOON)}
          {soon("Create Sale Return", "undo-2", SALE_RETURN_SOON)}
          {soon("Download PDF", "file-down", SALE_PDF_SOON)}
          {open && (
            <button type="button" className="sp-btn sp-btn--secondary" style={{ color: "var(--danger-500)" }} onClick={() => setDel(true)} disabled={pending}>
              <Icon name="trash-2" size={18} />
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="sp-card" style={{ padding: 32 }} data-testid="sale-details">
        <h2 className="t-section-title" style={{ textAlign: "center", margin: "0 0 24px" }}>
          Sale Details : {s.reference}
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 24 }}>
          <div data-testid="customer-info">
            <div className="sp-band">Customer Info</div>
            <div className="sp-info">
              <L i="user">{customer.name}</L>
              <L i="mail">{customer.email}</L>
              <L i="smartphone">{customer.phone}</L>
              <L i="map-pin">{customer.address}</L>
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
          <div data-testid="invoice-info">
            <div className="sp-band">Invoice Info</div>
            <div className="sp-info">
              <span>
                Reference : <b style={{ fontWeight: 600 }}>{s.reference}</b>
              </span>
              <span>
                Status :{" "}
                <span className={`sp-badge sp-badge--${SALE_STATUS_TONE[s.status]}`} data-status={s.status}>
                  <i />
                  {SALE_STATUS_LABEL[s.status]}
                </span>
              </span>
              <span>
                Warehouse : <b style={{ fontWeight: 600 }}>{s.warehouse}</b>
              </span>
              <span>
                Payment Status :{" "}
                <span className="sp-badge sp-badge--danger" data-payment="UNPAID">
                  <i />
                  Unpaid
                </span>
              </span>
              <span>
                Date : <b style={{ fontWeight: 600 }}>{s.date}</b>
              </span>
              <span>
                Paid : <b style={{ fontWeight: 600 }}>{s.paid}</b> · Due : <b style={{ fontWeight: 600 }}>{s.due}</b>
              </span>
              {s.quotation && (
                <span>
                  Quotation :{" "}
                  <Link href={`/quotations/${encodeURIComponent(s.quotation.id)}`} className="sp-code">
                    {s.quotation.reference}
                  </Link>
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
                  <th className="num">Net Unit Price</th>
                  <th className="num">Quantity</th>
                  <th className="num">Unit Price</th>
                  <th className="num">Discount</th>
                  <th className="num">Tax</th>
                  <th className="num">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {s.items.map((i) => (
                  <tr key={i.id}>
                    <td className="primary-cell">{i.product}</td>
                    <td className="num">{i.netUnitPrice}</td>
                    <td className="num">{i.quantity}</td>
                    <td className="num">{i.unitPrice}</td>
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
            <span>{s.orderTax}</span>
          </div>
          <div>
            <span>Discount</span>
            <span>{s.discount}</span>
          </div>
          <div>
            <span>Shipping</span>
            <span>{s.shipping}</span>
          </div>
          <div>
            <span>Grand Total</span>
            <span data-testid="details-grand">{s.grandTotal}</span>
          </div>
        </div>

        {s.notes && (
          <div style={{ marginTop: 24 }} data-testid="sale-notes">
            <div className="sp-band" style={{ marginBottom: 8 }}>
              Notes
            </div>
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{s.notes}</p>
          </div>
        )}

        <div className="t-caption" style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 4 }}>
          <span>
            Created by {s.createdBy} · {s.createdOn}
          </span>
          {s.completedOn ? <span>Completed {s.completedOn} — stock deducted from {s.warehouse}</span> : <span>Pending — no stock has been deducted from {s.warehouse} yet.</span>}
        </div>
      </div>

      {confirm && (
        <Modal
          title="Mark as Completed?"
          onClose={() => setConfirm(false)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setConfirm(false)} disabled={pending}>
                Cancel
              </button>
              <button type="button" className="sp-btn sp-btn--primary" onClick={complete} disabled={pending} data-testid="confirm-complete">
                {pending ? "Saving…" : "Mark as Completed"}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            Complete sale <b>{s.reference}</b>? The quantities will be deducted from <b>{s.warehouse}</b> now. Completed sales can&apos;t be edited or deleted.
          </p>
        </Modal>
      )}
      {del && <ConfirmDeleteModal itemType="sale" itemName={s.reference} busy={pending} onCancel={() => setDel(false)} onConfirm={remove} />}
    </>
  );
}
