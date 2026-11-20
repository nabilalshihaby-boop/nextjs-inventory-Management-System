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
import { PAYMENT_IMMUTABLE, type CustomerPaymentRow } from "@/lib/customer-payments";

// Port of design/Customer Payments.html: PageHeader (+ Record Customer Payment), TableToolbar
// (search, Customer, Payment Method, Deposited To, From/To date), DataTable (Payment Date /
// Reference No. / Customer / Payment Method / Deposited To / Amount / Applied To) with an amount
// footer, the row menu (View / Account Statement / Delete), Pagination, and the View modal. Every
// receipt is fully allocated to completed sales (customer credit isn't built, so there are no
// "Unallocated" rows). Account Statement links to /customers/statement. Deferred (disabled with a reason): Delete — payments are immutable.
type Currency = { code: string; symbol: string; right: boolean };

export default function CustomerPaymentsTable({ rows, customers, currency, initialQuery = "" }: { rows: CustomerPaymentRow[]; customers: { id: string; name: string }[]; currency: Currency | null; initialQuery?: string }) {
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
          Customer Payments
        </h1>
        <Link href="/customer-payments/record" className="sp-btn sp-btn--primary">
          <Icon name="plus" size={18} />
          Record Customer Payment
        </Link>
      </div>

      <div className="sp-toolbar" style={{ flexWrap: "wrap" }}>
        <div className="sp-group">
          <Icon name="search" size={18} className="sp-input-icon" />
          <input className="sp-input " placeholder="Search payments" aria-label="Search payments" value={q} onChange={(e) => reset(() => setQ(e.target.value))} />
        </div>
        <div className="sp-grow" />
        <div style={{ width: 190 }}>
          <select className="sp-select " aria-label="Customer" value={sup} onChange={(e) => reset(() => setSup(e.target.value))}>
            <option value="ALL">All Customers</option>
            {customers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ width: 170 }}>
          <select className="sp-select " aria-label="Payment Method" value={method} onChange={(e) => reset(() => setMethod(e.target.value))}>
            <option value="ALL">All</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div style={{ width: 170 }}>
          <select className="sp-select " aria-label="Deposited To" value={account} onChange={(e) => reset(() => setAccount(e.target.value))}>
            <option value="ALL">All Accounts</option>
            {accounts.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div style={{ width: 160 }}>
          <input type="date" className="sp-input " aria-label="From date" value={from} onChange={(e) => reset(() => setFrom(e.target.value))} />
        </div>
        <div style={{ width: 160 }}>
          <input type="date" className="sp-input " aria-label="To date" value={to} onChange={(e) => reset(() => setTo(e.target.value))} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="sp-card sp-empty" data-testid="empty">
          <Icon name="inbox" size={36} />
          <div className="t-section-title">{filtering ? "No payments match your filters" : "No customer payments yet"}</div>
          {filtering ? (
            <button type="button" className="sp-btn sp-btn--secondary" onClick={clear}>
              Clear filters
            </button>
          ) : (
            <Link href="/customer-payments/record" className="sp-btn sp-btn--primary">
              <Icon name="plus" size={18} />
              Record Customer Payment
            </Link>
          )}
        </div>
      ) : (
        <div className="sp-table-card">
          <div className="sp-table-scroll">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>Payment Date</th>
                  <th>Reference No.</th>
                  <th>Customer</th>
                  <th>Payment Method</th>
                  <th>Deposited To</th>
                  <th className="num">Amount</th>
                  <th>Applied To</th>
                  <th className="act">Action</th>
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
                      <span className="sp-badge sp-badge--primary">{r.method}</span>
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
                          { label: "View", icon: "eye", onClick: () => setView(r) },
                          { label: "Account Statement", icon: "file-text", href: `/customers/statement?customer=${encodeURIComponent(r.customerId)}` },
                          "-",
                          { label: "Delete", icon: "trash-2", danger: true, disabled: PAYMENT_IMMUTABLE },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr data-testid="totals" style={{ fontWeight: 700 }}>
                  <td colSpan={5} title={mixed ? "The total includes only payments in the current default currency" : undefined}>
                    Total{mixed ? ` (${currency?.code ?? ""} only)` : ""}
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
          title={`Payment ${view.reference}`}
          onClose={() => setView(null)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setView(null)}>
                Close
              </button>
              <Link href={`/customers/statement?customer=${encodeURIComponent(view.customerId)}`} className="sp-btn sp-btn--primary">
                <Icon name="file-text" size={18} />
                Account Statement
              </Link>
            </>
          }
        >
          <div data-testid="payment-view" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "12px 24px", font: "400 14px/20px var(--font-body)" }}>
            <b>Customer</b>
            <span>{view.customer}</span>
            <b>Payment Date</b>
            <span>{view.dateLabel}</span>
            <b>Method</b>
            <span>{view.method}</span>
            <b>Amount</b>
            <span data-testid="view-amount">{money(view.amount, view.currency)}</span>
            <b>Deposited To</b>
            <span>
              {view.account} <span className="t-caption">({view.ledgerReference})</span>
            </span>
            <b>Payment Reference</b>
            <span>{view.externalReference || "—"}</span>
            <b>Applied To</b>
            <span data-testid="view-applied">
              {view.appliedTo.map((a, i) => (
                <span key={a.saleId}>
                  {i > 0 && ", "}
                  <Link href={`/sales/${encodeURIComponent(a.saleId)}`}>{a.reference}</Link> ({money(a.amount, view.currency)})
                </span>
              ))}
            </span>
            <b>Status</b>
            <span>
              <span className="sp-badge sp-badge--success">Applied</span>
            </span>
            <b>Notes</b>
            <span style={{ whiteSpace: "pre-wrap" }}>{view.notes || "—"}</span>
            <b>Recorded</b>
            <span>
              {view.createdOn} by {view.createdBy}
            </span>
          </div>
        </Modal>
      )}
    </>
  );
}
