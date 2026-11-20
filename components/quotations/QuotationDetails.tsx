"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon, { type IconName } from "@/components/layout/Icon";
import Modal, { ConfirmDeleteModal } from "@/components/ui/Modal";
import { changeQuotationStatus, deleteQuotation } from "@/app/(dashboard)/quotations/actions";
import { convertQuotationToSale } from "@/app/(dashboard)/sales/actions";
import { QUOTATION_PDF_SOON, convertBlockedReason, QUOTATION_STATUS_LABEL, QUOTATION_STATUS_TONE, QUOTATION_TRANSITIONS, TRANSITION_LABEL, isEditable, type QuotationStatusValue } from "@/lib/quotations";

// Port of design/Quotation Details.html: PageHeader (+ Back), card with "Quotation Details : <ref>",
// Customer Info / Company Info / Quotation Info bands, Order Summary table and the totals summary.
// Added for the real lifecycle (each confirmed first, enforced again on the server):
// Draft → Mark as Sent (+ Edit / Delete); Sent → Mark as Accepted / Rejected / Expired.
// Accepted, Rejected and Expired quotations are read-only. Accepted → "Convert to Sale" (confirmed)
// creates ONE Pending sale from the stored snapshot (no stock moves until that sale is completed);
// afterwards it links to the sale. Download PDF is deferred (disabled). Nothing here moves stock or money.

type Details = {
  id: string;
  reference: string;
  status: QuotationStatusValue;
  date: string;
  warehouse: string;
  createdBy: string;
  createdOn: string;
  statusChanged: string | null;
  notes: string;
  sale: { id: string; reference: string } | null;
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
const TRANSITION_ICON: Partial<Record<QuotationStatusValue, IconName>> = { SENT: "send", ACCEPTED: "circle-check", REJECTED: "circle-x", EXPIRED: "clock" };
const TRANSITION_HINT: Partial<Record<QuotationStatusValue, string>> = {
  SENT: "The quotation is locked for editing once it is sent.",
  ACCEPTED: "Accepted quotations are final and can then be converted to a sale.",
  REJECTED: "Rejected quotations are final.",
  EXPIRED: "Expired quotations are final.",
};

export default function QuotationDetails({ quotation: q, customer, company }: { quotation: Details; customer: Party; company: Party }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<QuotationStatusValue | null>(null);
  const [converting, setConverting] = useState(false);
  const [del, setDel] = useState(false);
  const [pending, startTransition] = useTransition();
  const draft = isEditable(q.status);
  const next = QUOTATION_TRANSITIONS[q.status];

  function move(to: QuotationStatusValue) {
    startTransition(async () => {
      try {
        const r = await changeQuotationStatus(q.id, to);
        setConfirm(null);
        if (!r.ok) toast.error(r.message, { id: "quotation" });
        else toast.success(r.message, { id: "quotation" });
        router.refresh();
      } catch {
        toast.error("Something went wrong. Please try again.", { id: "quotation" });
      }
    });
  }
  function convert() {
    startTransition(async () => {
      try {
        const r = await convertQuotationToSale(q.id);
        setConverting(false);
        if (!r.ok) {
          toast.error(r.message, { id: "quotation" });
          return void router.refresh();
        }
        toast.success(r.message, { id: "quotation", duration: 6000 });
        router.push(r.id ? `/sales/${encodeURIComponent(r.id)}` : "/sales");
        router.refresh();
      } catch {
        toast.error("Something went wrong. Please try again.", { id: "quotation" });
      }
    });
  }
  function remove() {
    startTransition(async () => {
      try {
        const r = await deleteQuotation(q.id);
        setDel(false);
        if (!r.ok) {
          toast.error(r.message, { id: "quotation" });
          return void router.refresh();
        }
        toast.success(r.message, { id: "quotation" });
        router.push("/quotations");
        router.refresh();
      } catch {
        toast.error("Something went wrong. Please try again.", { id: "quotation" });
      }
    });
  }

  const soon = (label: string, icon: IconName, why: string) => (
    <button type="button" className="sp-btn sp-btn--secondary" aria-disabled="true" title={why} aria-label={`${label} (${why})`} style={{ opacity: 0.5, cursor: "not-allowed" }} onClick={() => toast(why, { id: "quotation-soon", icon: "ℹ️" })}>
      <Icon name={icon} size={18} />
      {label}
    </button>
  );

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          Quotation Details
        </h1>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }} data-testid="quotation-actions">
          <Link href="/quotations" className="sp-btn sp-btn--secondary">
            <Icon name="arrow-left" size={18} />
            Back
          </Link>
          {draft && (
            <Link href={`/quotations/${encodeURIComponent(q.id)}/edit`} className="sp-btn sp-btn--secondary">
              <Icon name="pencil" size={18} />
              Edit
            </Link>
          )}
          {next.map((s) => (
            <button key={s} type="button" className={"sp-btn " + (s === "SENT" || s === "ACCEPTED" ? "sp-btn--primary" : "sp-btn--secondary")} onClick={() => setConfirm(s)} disabled={pending}>
              <Icon name={TRANSITION_ICON[s] ?? "circle-check"} size={18} />
              {TRANSITION_LABEL[s]}
            </button>
          ))}
          {q.sale ? (
            <Link href={`/sales/${encodeURIComponent(q.sale.id)}`} className="sp-btn sp-btn--secondary" data-testid="quotation-sale">
              <Icon name="shopping-cart" size={18} />
              View Sale {q.sale.reference}
            </Link>
          ) : convertBlockedReason(q.status, null) ? (
            soon("Convert to Sale", "shopping-cart", convertBlockedReason(q.status, null)!)
          ) : (
            <button type="button" className="sp-btn sp-btn--primary" onClick={() => setConverting(true)} disabled={pending}>
              <Icon name="shopping-cart" size={18} />
              Convert to Sale
            </button>
          )}
          {soon("Download PDF", "file-down", QUOTATION_PDF_SOON)}
          {draft && (
            <button type="button" className="sp-btn sp-btn--secondary" style={{ color: "var(--danger-500)" }} onClick={() => setDel(true)} disabled={pending}>
              <Icon name="trash-2" size={18} />
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="sp-card" style={{ padding: 32 }} data-testid="quotation-details">
        <h2 className="t-section-title" style={{ textAlign: "center", margin: "0 0 24px" }}>
          Quotation Details : {q.reference}
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
          <div data-testid="quotation-info">
            <div className="sp-band">Quotation Info</div>
            <div className="sp-info">
              <span>
                Reference : <b style={{ fontWeight: 600 }}>{q.reference}</b>
              </span>
              <span>
                Status :{" "}
                <span className={`sp-badge sp-badge--${QUOTATION_STATUS_TONE[q.status]}`} data-status={q.status}>
                  <i />
                  {QUOTATION_STATUS_LABEL[q.status]}
                </span>
              </span>
              <span>
                Warehouse : <b style={{ fontWeight: 600 }}>{q.warehouse}</b>
              </span>
              <span>
                Date : <b style={{ fontWeight: 600 }}>{q.date}</b>
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
                  <th className="num">Net Unit Price</th>
                  <th className="num">Quantity</th>
                  <th className="num">Unit Price</th>
                  <th className="num">Discount</th>
                  <th className="num">Tax</th>
                  <th className="num">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {q.items.map((i) => (
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
            <span>{q.orderTax}</span>
          </div>
          <div>
            <span>Discount</span>
            <span>{q.discount}</span>
          </div>
          <div>
            <span>Shipping</span>
            <span>{q.shipping}</span>
          </div>
          <div>
            <span>Grand Total</span>
            <span data-testid="details-grand">{q.grandTotal}</span>
          </div>
        </div>

        {q.notes && (
          <div style={{ marginTop: 24 }} data-testid="quotation-notes">
            <div className="sp-band" style={{ marginBottom: 8 }}>
              Notes
            </div>
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{q.notes}</p>
          </div>
        )}

        <div className="t-caption" style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 4 }}>
          <span>
            Created by {q.createdBy} · {q.createdOn}
          </span>
          {q.statusChanged && <span>{q.statusChanged}</span>}
          <span>A quotation is an offer only — it doesn&apos;t reserve or move stock and records no payment.</span>
        </div>
      </div>

      {confirm && (
        <Modal
          title={`${TRANSITION_LABEL[confirm]}?`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setConfirm(null)} disabled={pending}>
                Cancel
              </button>
              <button type="button" className="sp-btn sp-btn--primary" onClick={() => move(confirm)} disabled={pending} data-testid="confirm-status">
                {pending ? "Saving…" : TRANSITION_LABEL[confirm]}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            Mark quotation <b>{q.reference}</b> as <b>{QUOTATION_STATUS_LABEL[confirm]}</b>? {TRANSITION_HINT[confirm]}
          </p>
        </Modal>
      )}
      {converting && (
        <Modal
          title="Convert to Sale?"
          onClose={() => setConverting(false)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setConverting(false)} disabled={pending}>
                Cancel
              </button>
              <button type="button" className="sp-btn sp-btn--primary" onClick={convert} disabled={pending} data-testid="confirm-convert">
                {pending ? "Creating…" : "Create Sale"}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            Create a <b>Pending</b> sale from quotation <b>{q.reference}</b> with the same customer, warehouse, items and totals? No stock is deducted until the sale is completed. A quotation can be converted only once.
          </p>
        </Modal>
      )}
      {del && <ConfirmDeleteModal itemType="quotation" itemName={q.reference} busy={pending} onCancel={() => setDel(false)} onConfirm={remove} />}
    </>
  );
}
