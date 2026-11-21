"use client";

import Link from "next/link";
import { useState } from "react";
import Icon from "@/components/layout/Icon";
import Modal from "@/components/ui/Modal";
import Pagination, { paginate } from "@/components/ui/Pagination";
import RowMenu from "@/components/ui/RowMenu";
import { PAYMENT_METHODS } from "@/lib/cash-bank";
import { formatMoney } from "@/lib/money";
import { fromUnits, toUnits } from "@/lib/transfers";
import type { CustomerPaymentRow } from "@/lib/customer-payments";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";

// Port of design/Customer Payments.html: PageHeader (+ Record Customer Payment), TableToolbar
// (search, Customer, Payment Method, Deposited To, From/To date), DataTable (Payment Date /
// Reference No. / Customer / Payment Method / Deposited To / Amount / Applied To) with an amount
// footer, the row menu (View / Account Statement / Delete), Pagination, and the View modal. Every
// receipt is fully allocated to completed sales (customer credit isn't built, so there are no
// "Unallocated" rows). Account Statement links to /customers/statement. Deferred (disabled with a reason): Delete — payments are immutable.
type Currency = { code: string; symbol: string; right: boolean };

export default function CustomerPaymentsTable({ rows, customers, currency, initialQuery = "" }: { rows: CustomerPaymentRow[]; customers: { id: string; name: string }[]; currency: Currency | null; initialQuery?: string }) {
  const T = useT();
  const C = T.custPay;
  const L = C.list;
  const meth = (m: string) => (T.sales.methods as Record<string, string>)[m] ?? m;
  const [q, setQ] = useState(initialQuery);
  const [sup, setSup] = useState("ALL");
  const [method, setMethod] = useState("ALL");
  const [account, setAccount] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [view, setView] = useState<CustomerPaymentRow | null>(null);
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const needle = q.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (!needle || [r.reference, r.externalReference, r.notes, r.customer, r.ledgerReference, ...r.appliedTo.map((a) => a.reference)].join(" ").toLowerCase().includes(needle)) &&
      (sup === "ALL" || r.customerId === sup) &&
      (method === "ALL" || r.method === method) &&
      (account === "ALL" || r.account === account) &&
      (!from || r.date >= from) &&
      (!to || r.date <= to),
  );
  const filtering = !!needle || sup !== "ALL" || method !== "ALL" || account !== "ALL" || !!from || !!to;
  const accounts = [...new Set(rows.map((r) => r.account))].sort();
  const p = paginate(filtered, page, size);
  const total = fromUnits(filtered.filter((r) => r.inDefaultCurrency).reduce((a, r) => a + toUnits(r.amount, 2), BigInt(0)), 2);
  const mixed = filtered.some((r) => !r.inDefaultCurrency);
  const money = (v: string, c: Currency | null) => formatMoney(v, c);
  const clear = () => {
    setQ("");
    setSup("ALL");
    setMethod("ALL");
    setAccount("ALL");
    setFrom("");
    setTo("");
    setPage(1);
  };

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {L.title}
        </h1>
        <Link href="/customer-payments/record" className="sp-btn sp-btn--primary">
          <Icon name="plus" size={18} />
          {L.record}
        </Link>
      </div>

      <div className="sp-toolbar" style={{ flexWrap: "wrap" }}>
        <div className="sp-group">
          <Icon name="search" size={18} className="sp-input-icon" />
          <input className="sp-input " placeholder={L.search} aria-label={L.search} value={q} onChange={(e) => reset(() => setQ(e.target.value))} />
        </div>
        <div className="sp-grow" />
        <div style={{ width: 190 }}>
          <select className="sp-select " aria-label={L.customer} value={sup} onChange={(e) => reset(() => setSup(e.target.value))}>
            <option value="ALL">{L.allCustomers}</option>
            {customers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ width: 170 }}>
          <select className="sp-select " aria-label={L.method} value={method} onChange={(e) => reset(() => setMethod(e.target.value))}>
            <option value="ALL">{L.all}</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {meth(m)}
              </option>
            ))}
          </select>
        </div>
        <div style={{ width: 170 }}>
          <select className="sp-select " aria-label={L.depositedTo} value={account} onChange={(e) => reset(() => setAccount(e.target.value))}>
            <option value="ALL">{L.allAccounts}</option>
            {accounts.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div style={{ width: 160 }}>
          <input type="date" className="sp-input " aria-label={L.fromDate} value={from} onChange={(e) => reset(() => setFrom(e.target.value))} />
        </div>
        <div style={{ width: 160 }}>
          <input type="date" className="sp-input " aria-label={L.toDate} value={to} onChange={(e) => reset(() => setTo(e.target.value))} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="sp-card sp-empty" data-testid="empty">
          <Icon name="inbox" size={36} />
          <div className="t-section-title">{filtering ? L.noMatch : L.none}</div>
          {filtering ? (
            <button type="button" className="sp-btn sp-btn--secondary" onClick={clear}>
              {L.clear}
            </button>
          ) : (
            <Link href="/customer-payments/record" className="sp-btn sp-btn--primary">
              <Icon name="plus" size={18} />
              {L.record}
            </Link>
          )}
        </div>
      ) : (
        <div className="sp-table-card">
          <div className="sp-table-scroll">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>{L.paymentDate}</th>
                  <th>{L.refNo}</th>
                  <th>{L.customer}</th>
                  <th>{L.method}</th>
                  <th>{L.depositedTo}</th>
                  <th className="num">{L.amount}</th>
                  <th>{L.appliedTo}</th>
                  <th className="act">{L.action}</th>
                </tr>
              </thead>
              <tbody>
                {p.visible.map((r) => (
                  <tr key={r.id} data-ref={r.reference}>
                    <td>{r.dateLabel}</td>
                    <td>
                      <span className="sp-code">{r.reference}</span>
                    </td>
                    <td className="primary-cell">{r.customer}</td>
                    <td>
                      <span className="sp-badge sp-badge--primary">{meth(r.method)}</span>
                    </td>
                    <td>{r.account}</td>
                    <td className="num" data-col="amount">{money(r.amount, r.currency)}</td>
                    <td data-col="applied">
                      {r.appliedTo.map((a, i) => (
                        <span key={a.saleId}>
                          {i > 0 && ", "}
                          <Link href={`/sales/${encodeURIComponent(a.saleId)}`}>{a.reference}</Link>
                        </span>
                      ))}
                    </td>
                    <td className="act">
                      <RowMenu
                        label={r.reference}
                        items={[
                          { label: L.view, icon: "eye", onClick: () => setView(r) },
                          { label: L.statement, icon: "file-text", href: `/customers/statement?customer=${encodeURIComponent(r.customerId)}` },
                          "-",
                          { label: L.delete, icon: "trash-2", danger: true, disabled: C.immutable },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr data-testid="totals" style={{ fontWeight: 700 }}>
                  <td colSpan={5} title={mixed ? L.totalMixed : undefined}>
                    {mixed ? fmt(L.totalCur, { code: currency?.code ?? "" }) : L.total}
                  </td>
                  <td className="num" data-testid="total-amount">{money(total, currency)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
          <Pagination page={p.current} last={p.last} pageSize={size} from={p.from} to={p.to} total={p.total} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} />
        </div>
      )}

      {view && (
        <Modal
          size="md"
          title={fmt(L.modalTitle, { ref: view.reference })}
          onClose={() => setView(null)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setView(null)}>
                {L.close}
              </button>
              <Link href={`/customers/statement?customer=${encodeURIComponent(view.customerId)}`} className="sp-btn sp-btn--primary">
                <Icon name="file-text" size={18} />
                {L.statement}
              </Link>
            </>
          }
        >
          <div data-testid="payment-view" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "12px 24px", font: "400 14px/20px var(--font-body)" }}>
            <b>{L.customer}</b>
            <span>{view.customer}</span>
            <b>{L.paymentDate}</b>
            <span>{view.dateLabel}</span>
            <b>{T.custPay.form.method}</b>
            <span>{meth(view.method)}</span>
            <b>{L.amount}</b>
            <span data-testid="view-amount">{money(view.amount, view.currency)}</span>
            <b>{L.depositedTo}</b>
            <span>
              {view.account} <span className="t-caption">({view.ledgerReference})</span>
            </span>
            <b>{L.paymentRef}</b>
            <span>{view.externalReference || "—"}</span>
            <b>{L.appliedTo}</b>
            <span data-testid="view-applied">
              {view.appliedTo.map((a, i) => (
                <span key={a.saleId}>
                  {i > 0 && ", "}
                  <Link href={`/sales/${encodeURIComponent(a.saleId)}`}>{a.reference}</Link> ({money(a.amount, view.currency)})
                </span>
              ))}
            </span>
            <b>{L.status}</b>
            <span>
              <span className="sp-badge sp-badge--success">{L.applied}</span>
            </span>
            <b>{L.notes}</b>
            <span style={{ whiteSpace: "pre-wrap" }}>{view.notes || "—"}</span>
            <b>{L.recorded}</b>
            <span>{fmt(L.recordedBy, { on: view.createdOn, by: view.createdBy })}</span>
          </div>
        </Modal>
      )}
    </>
  );
}
