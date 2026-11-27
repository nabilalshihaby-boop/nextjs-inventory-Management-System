"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon, { type IconName } from "@/components/layout/Icon";
import Modal, { ConfirmDeleteModal } from "@/components/ui/Modal";
import { completeSale, deleteSale } from "@/app/(dashboard)/sales/actions";
import { PAYMENT_STATUS_TONE, type PaymentStatusValue } from "@/lib/purchases";
import { SALE_STATUS_TONE, type SaleStatusValue } from "@/lib/sales";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import { tr } from "@/lib/i18n/messages";

// Port of design/Sale Details.html: PageHeader (+ Back), card with "Sale Details : <ref>", Customer
// Info / Company Info / Invoice Info bands (Reference, Status, Warehouse, Payment Status), Order
// Summary table and the totals summary. Added for the real lifecycle: Pending → "Mark as Completed"
// (confirmed; the server deducts stock exactly once or refuses), Edit and Delete while Pending.
// Completed sales are read-only; "Create Sale Return" opens the return form for a Completed sale
// with something returnable and unpaid, and its returns are listed. Deferred (disabled with a
// reason): Download PDF. Record Payment / Show Payments link to Customer Payments; its payments are
// listed. Paid = Σ customer-payment allocations; Due = Grand Total − Paid − completed returns.

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
  returned: string;
  due: string;
  paymentStatus: PaymentStatusValue;
  returnBlocked: string | null;
  paymentBlocked: string | null;
  payments: { id: string; reference: string; date: string; method: string; account: string; amount: string }[];
  returns: { id: string; reference: string; date: string; total: string }[];
  orderTax: string;
  discount: string;
  shipping: string;
  grandTotal: string;
  items: { id: string; product: string; netUnitPrice: string; quantity: string; unitPrice: string; discount: string; tax: string; subtotal: string }[];
};
type Party = { name: string; email: string; phone: string; address: string };

// `d`: ltr for emails/phones (always readable left-to-right, even in Arabic), auto for names/addresses.
const L = ({ i, d = "auto", children }: { i: IconName; d?: "ltr" | "auto"; children: ReactNode }) => (
  <span>
    <Icon name={i} size={16} className="sp-icon" />
    <bdi dir={d}>{children}</bdi>
  </span>
);

export default function SaleDetails({ sale: s, customer, company }: { sale: Details; customer: Party; company: Party }) {
  const router = useRouter();
  const T = useT();
  const S = T.sales;
  const D = S.details;
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
        toast.error(T.common.somethingWrong, { id: "sale" });
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
        toast.error(T.common.somethingWrong, { id: "sale" });
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
          {D.title}
        </h1>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }} data-testid="sale-actions">
          <Link href="/sales" className="sp-btn sp-btn--secondary">
            <Icon name="arrow-left" size={18} />
            {D.back}
          </Link>
          {open && (
            <Link href={`/sales/${encodeURIComponent(s.id)}/edit`} className="sp-btn sp-btn--secondary">
              <Icon name="pencil" size={18} />
              {D.edit}
            </Link>
          )}
          {open && (
            <button type="button" className="sp-btn sp-btn--primary" onClick={() => setConfirm(true)} disabled={pending}>
              <Icon name="circle-check" size={18} />
              {D.markCompleted}
            </button>
          )}
          {s.paymentBlocked ? (
            soon(D.recordPayment, "wallet", tr(T, s.paymentBlocked))
          ) : (
            <Link href={`/customer-payments/record?sale=${encodeURIComponent(s.id)}`} className="sp-btn sp-btn--primary">
              <Icon name="wallet" size={18} />
              {D.recordPayment}
            </Link>
          )}
          {s.payments.length ? (
            <Link href={`/customer-payments?q=${encodeURIComponent(s.reference)}`} className="sp-btn sp-btn--secondary">
              <Icon name="dollar-sign" size={18} />
              {D.showPayments}
            </Link>
          ) : (
            soon(D.showPayments, "dollar-sign", S.block.noPayments)
          )}
          {s.returnBlocked ? (
            soon(D.createReturn, "undo-2", tr(T, s.returnBlocked))
          ) : (
            <Link href={`/sales/returns/create?sale=${encodeURIComponent(s.id)}`} className="sp-btn sp-btn--secondary">
              <Icon name="undo-2" size={18} />
              {D.createReturn}
            </Link>
          )}
          {soon(D.downloadPdf, "file-down", S.pdfSoon)}
          {open && (
            <button type="button" className="sp-btn sp-btn--secondary" style={{ color: "var(--danger-500)" }} onClick={() => setDel(true)} disabled={pending}>
              <Icon name="trash-2" size={18} />
              {D.delete}
            </button>
          )}
        </div>
      </div>

      <div className="sp-card" style={{ padding: 32 }} data-testid="sale-details">
        <h2 className="t-section-title" style={{ textAlign: "center", margin: "0 0 24px" }}>
          {fmt(D.headline, { ref: s.reference })}
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
          <div data-testid="invoice-info">
            <div className="sp-band">{D.invoiceInfo}</div>
            <div className="sp-info">
              <span>
                {D.reference} : <b style={{ fontWeight: 600 }} dir="ltr">{s.reference}</b>
              </span>
              <span>
                {D.status} :{" "}
                <span className={`sp-badge sp-badge--${SALE_STATUS_TONE[s.status]}`} data-status={s.status}>
                  <i />
                  {S.status[s.status]}
                </span>
              </span>
              <span>
                {D.warehouse} : <b style={{ fontWeight: 600 }}>{s.warehouse}</b>
              </span>
              <span>
                {D.paymentStatus} :{" "}
                <span className={`sp-badge sp-badge--${PAYMENT_STATUS_TONE[s.paymentStatus]}`} data-payment={s.paymentStatus}>
                  <i />
                  {S.payStatus[s.paymentStatus]}
                </span>
              </span>
              <span>
                {D.date} : <b style={{ fontWeight: 600 }}>{s.date}</b>
              </span>
              <span>
                {D.paid} : <b style={{ fontWeight: 600 }}>{s.paid}</b> · {D.due} : <b style={{ fontWeight: 600 }}>{s.due}</b>
              </span>
              {s.returns.length > 0 && (
                <span>
                  {D.returned} : <b style={{ fontWeight: 600 }}>{s.returned}</b>
                </span>
              )}
              {s.quotation && (
                <span>
                  {D.quotation} :{" "}
                  <Link href={`/quotations/${encodeURIComponent(s.quotation.id)}`} className="sp-code">
                    {s.quotation.reference}
                  </Link>
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
                  <th className="num">{D.colUnitPrice}</th>
                  <th className="num">{D.colDiscount}</th>
                  <th className="num">{D.colTax}</th>
                  <th className="num">{D.colSubtotal}</th>
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
            <span>{D.orderTax}</span>
            <span>{s.orderTax}</span>
          </div>
          <div>
            <span>{D.discount}</span>
            <span>{s.discount}</span>
          </div>
          <div>
            <span>{D.shipping}</span>
            <span>{s.shipping}</span>
          </div>
          <div>
            <span>{D.grandTotal}</span>
            <span data-testid="details-grand">{s.grandTotal}</span>
          </div>
        </div>

        {s.returns.length > 0 && (
          <>
            <div className="sp-band" style={{ margin: "32px 0 16px" }}>
              {D.salesReturns}
            </div>
            <div className="sp-table-card" style={{ boxShadow: "none" }}>
              <table className="sp-table" data-testid="sale-returns">
                <thead>
                  <tr>
                    <th>{D.colReference}</th>
                    <th>{D.colDate}</th>
                    <th className="num">{D.grandTotal}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.returns.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/sales/returns/${encodeURIComponent(r.id)}`} className="sp-code">
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

        {s.payments.length > 0 && (
          <>
            <div className="sp-band" style={{ margin: "32px 0 16px" }}>
              {D.payments}
            </div>
            <div className="sp-table-card" style={{ boxShadow: "none" }}>
              <table className="sp-table" data-testid="sale-payments">
                <thead>
                  <tr>
                    <th>{D.colReference}</th>
                    <th>{D.colDate}</th>
                    <th>{D.colMethod}</th>
                    <th>{D.colDepositedTo}</th>
                    <th className="num">{D.colApplied}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.payments.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <span className="sp-code">{r.reference}</span>
                      </td>
                      <td>{r.date}</td>
                      <td>{(S.methods as Record<string, string>)[r.method] ?? r.method}</td>
                      <td>{r.account}</td>
                      <td className="num">{r.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {s.notes && (
          <div style={{ marginTop: 24 }} data-testid="sale-notes">
            <div className="sp-band" style={{ marginBottom: 8 }}>
              {D.notes}
            </div>
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{s.notes}</p>
          </div>
        )}

        <div className="t-caption" style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 4 }}>
          <span>
            {fmt(D.createdBy, { by: s.createdBy, on: s.createdOn })}
          </span>
          {s.completedOn ? <span>{fmt(D.completedLine, { on: s.completedOn, warehouse: s.warehouse })}</span> : <span>{fmt(D.pendingLine, { warehouse: s.warehouse })}</span>}
        </div>
      </div>

      {confirm && (
        <Modal
          title={D.confirmTitle}
          onClose={() => setConfirm(false)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setConfirm(false)} disabled={pending}>
                {D.cancel}
              </button>
              <button type="button" className="sp-btn sp-btn--primary" onClick={complete} disabled={pending} data-testid="confirm-complete">
                {pending ? D.saving : D.markCompleted}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>{fmt(D.confirmBody, { ref: s.reference, warehouse: s.warehouse })}</p>
        </Modal>
      )}
      {del && <ConfirmDeleteModal itemType={S.list.deleteType} itemName={s.reference} busy={pending} onCancel={() => setDel(false)} onConfirm={remove} />}
    </>
  );
}
