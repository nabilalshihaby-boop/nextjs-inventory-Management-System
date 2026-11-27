"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon, { type IconName } from "@/components/layout/Icon";
import Modal, { ConfirmDeleteModal } from "@/components/ui/Modal";
import { changeQuotationStatus, deleteQuotation } from "@/app/(dashboard)/quotations/actions";
import { convertQuotationToSale } from "@/app/(dashboard)/sales/actions";
import { convertBlockedReason, QUOTATION_STATUS_TONE, QUOTATION_TRANSITIONS, isEditable, type QuotationStatusValue } from "@/lib/quotations";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import { tr } from "@/lib/i18n/messages";

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

const L = ({ i, d = "auto", children }: { i: IconName; d?: "ltr" | "auto"; children: ReactNode }) => (
  <span>
    <Icon name={i} size={16} className="sp-icon" />
    <bdi dir={d}>{children}</bdi>
  </span>
);
const TRANSITION_ICON: Partial<Record<QuotationStatusValue, IconName>> = { SENT: "send", ACCEPTED: "circle-check", REJECTED: "circle-x", EXPIRED: "clock" };

export default function QuotationDetails({ quotation: q, customer, company }: { quotation: Details; customer: Party; company: Party }) {
  const router = useRouter();
  const T = useT();
  const D = T.quotations.details;
  const Q = T.quotations;
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
        toast.error(T.common.somethingWrong, { id: "quotation" });
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
        toast.error(T.common.somethingWrong, { id: "quotation" });
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
        toast.error(T.common.somethingWrong, { id: "quotation" });
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
          {D.title}
        </h1>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }} data-testid="quotation-actions">
          <Link href="/quotations" className="sp-btn sp-btn--secondary">
            <Icon name="arrow-left" size={18} />
            {D.back}
          </Link>
          {draft && (
            <Link href={`/quotations/${encodeURIComponent(q.id)}/edit`} className="sp-btn sp-btn--secondary">
              <Icon name="pencil" size={18} />
              {D.edit}
            </Link>
          )}
          {next.map((s) => (
            <button key={s} type="button" className={"sp-btn " + (s === "SENT" || s === "ACCEPTED" ? "sp-btn--primary" : "sp-btn--secondary")} onClick={() => setConfirm(s)} disabled={pending}>
              <Icon name={TRANSITION_ICON[s] ?? "circle-check"} size={18} />
              {Q.transition[s]}
            </button>
          ))}
          {q.sale ? (
            <Link href={`/sales/${encodeURIComponent(q.sale.id)}`} className="sp-btn sp-btn--secondary" data-testid="quotation-sale">
              <Icon name="shopping-cart" size={18} />
              {fmt(D.viewSale, { ref: q.sale.reference })}
            </Link>
          ) : convertBlockedReason(q.status, null) ? (
            soon(D.convert, "shopping-cart", tr(T, convertBlockedReason(q.status, null)!.key, convertBlockedReason(q.status, null)!.vars))
          ) : (
            <button type="button" className="sp-btn sp-btn--primary" onClick={() => setConverting(true)} disabled={pending}>
              <Icon name="shopping-cart" size={18} />
              {D.convert}
            </button>
          )}
          {soon(T.sales.details.downloadPdf, "file-down", T.sales.pdfSoon)}
          {draft && (
            <button type="button" className="sp-btn sp-btn--secondary" style={{ color: "var(--danger-500)" }} onClick={() => setDel(true)} disabled={pending}>
              <Icon name="trash-2" size={18} />
              {D.delete}
            </button>
          )}
        </div>
      </div>

      <div className="sp-card" style={{ padding: 32 }} data-testid="quotation-details">
        <h2 className="t-section-title" style={{ textAlign: "center", margin: "0 0 24px" }}>
          {fmt(D.headline, { ref: q.reference })}
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 24 }}>
          <div data-testid="customer-info">
            <div className="sp-band">{D.customerInfo}</div>
            <div className="sp-info">
              <L i="user">{customer.name}</L>
              {customer.email && <L i="mail" d="ltr">{customer.email}</L>}
              {customer.phone && <L i="smartphone" d="ltr">{customer.phone}</L>}
              {customer.address && <L i="map-pin">{customer.address}</L>}
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
          <div data-testid="quotation-info">
            <div className="sp-band">{D.quotationInfo}</div>
            <div className="sp-info">
              <span>
                {D.reference} : <b style={{ fontWeight: 600 }} dir="ltr">{q.reference}</b>
              </span>
              <span>
                {D.status} :{" "}
                <span className={`sp-badge sp-badge--${QUOTATION_STATUS_TONE[q.status]}`} data-status={q.status}>
                  <i />
                  {Q.status[q.status]}
                </span>
              </span>
              <span>
                {D.warehouse} : <b style={{ fontWeight: 600 }}>{q.warehouse}</b>
              </span>
              <span>
                {D.date} : <b style={{ fontWeight: 600 }}>{q.date}</b>
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
                  <th className="num">{D.colUnitPrice}</th>
                  <th className="num">{D.colDiscount}</th>
                  <th className="num">{D.colTax}</th>
                  <th className="num">{D.colSubtotal}</th>
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
            <span>{D.orderTax}</span>
            <span>{q.orderTax}</span>
          </div>
          <div>
            <span>{D.discount}</span>
            <span>{q.discount}</span>
          </div>
          <div>
            <span>{D.shipping}</span>
            <span>{q.shipping}</span>
          </div>
          <div>
            <span>{D.grandTotal}</span>
            <span data-testid="details-grand">{q.grandTotal}</span>
          </div>
        </div>

        {q.notes && (
          <div style={{ marginTop: 24 }} data-testid="quotation-notes">
            <div className="sp-band" style={{ marginBottom: 8 }}>
              {D.notes}
            </div>
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{q.notes}</p>
          </div>
        )}

        <div className="t-caption" style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 4 }}>
          <span>
            {fmt(D.createdBy, { by: q.createdBy, on: q.createdOn })}
          </span>
          {q.statusChanged && <span>{q.statusChanged}</span>}
          <span>{D.offerNote}</span>
        </div>
      </div>

      {confirm && (
        <Modal
          title={fmt(D.confirmTitle, { action: Q.transition[confirm] })}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setConfirm(null)} disabled={pending}>
                {D.cancel}
              </button>
              <button type="button" className="sp-btn sp-btn--primary" onClick={() => move(confirm)} disabled={pending} data-testid="confirm-status">
                {pending ? D.saving : Q.transition[confirm]}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>{fmt(D.confirmBody, { ref: q.reference, status: Q.status[confirm], hint: Q.hint[confirm] })}</p>
        </Modal>
      )}
      {converting && (
        <Modal
          title={D.convertTitle}
          onClose={() => setConverting(false)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setConverting(false)} disabled={pending}>
                {D.cancel}
              </button>
              <button type="button" className="sp-btn sp-btn--primary" onClick={convert} disabled={pending} data-testid="confirm-convert">
                {pending ? D.creating : D.createSale}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>{fmt(D.convertBody, { ref: q.reference })}</p>
        </Modal>
      )}
      {del && <ConfirmDeleteModal itemType={Q.list.deleteType} itemName={q.reference} busy={pending} onCancel={() => setDel(false)} onConfirm={remove} />}
    </>
  );
}
