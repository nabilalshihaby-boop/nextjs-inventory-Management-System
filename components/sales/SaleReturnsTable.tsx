"use client";

import Link from "next/link";
import { useState } from "react";
import Icon from "@/components/layout/Icon";
import Pagination, { paginate } from "@/components/ui/Pagination";
import RowMenu from "@/components/ui/RowMenu";
import { formatMoney } from "@/lib/money";
import { fromUnits, toUnits } from "@/lib/transfers";
import type { SaleReturnRow } from "@/lib/sale-returns";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";

// Port of design/Sales Returns.html: TableToolbar (search, Filter, date, Create Sale Return),
// DataTable (Reference / Customer / Warehouse / Status / Grand Total / Paid / Payment Status /
// Created On) with a Grand Total footer, the row menu and Pagination. Filter opens Customer + Sale
// filters. Every return is Completed and immutable. "Paid" = refunded to the customer — refunds
// aren't built, so it is 0; the return value is credited against the original sale's due ("Sale
// credit"). Deferred (disabled, explained): Download PDF, Edit, Delete.
type Currency = { code: string; symbol: string; right: boolean };

export default function SaleReturnsTable({ rows, customers, currency }: { rows: SaleReturnRow[]; customers: { id: string; name: string }[]; currency: Currency | null }) {
  const T = useT();
  const R = T.salesReturns;
  const L = R.list;
  const [q, setQ] = useState("");
  const [date, setDate] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [customer, setCustomer] = useState("ALL");
  const [sale, setSale] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);

  const needle = q.trim().toLowerCase();
  const saleNeedle = sale.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (!needle || [r.reference, r.saleRef, r.customer, r.warehouse].join(" ").toLowerCase().includes(needle)) &&
      (!date || r.date === date) &&
      (customer === "ALL" || r.customerId === customer) &&
      (!saleNeedle || r.saleRef.toLowerCase().includes(saleNeedle)),
  );
  const activeFilters = (customer !== "ALL" ? 1 : 0) + (saleNeedle ? 1 : 0);
  const filtering = !!needle || !!date || activeFilters > 0;
  const p = paginate(filtered, page, size);
  const total = fromUnits(filtered.filter((r) => r.inDefaultCurrency).reduce((a, r) => a + toUnits(r.grandTotal, 2), BigInt(0)), 2);
  const mixed = filtered.some((r) => !r.inDefaultCurrency);
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };
  const clear = () => {
    setQ("");
    setDate("");
    setCustomer("ALL");
    setSale("");
    setPage(1);
  };

  return (
    <>
      <div className="sp-toolbar">
        <div className="sp-group">
          <Icon name="search" size={18} className="sp-input-icon" />
          <input className="sp-input " placeholder={L.search} aria-label={L.searchAria} value={q} onChange={(e) => reset(() => setQ(e.target.value))} />
        </div>
        <div className="sp-grow" />
        <button type="button" className={"sp-btn sp-btn--icon " + (showFilters || activeFilters ? "sp-btn--primary" : "sp-btn--secondary")} aria-label={activeFilters ? fmt(L.filterActive, { n: activeFilters }) : L.filter} aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
          <Icon name="filter" size={18} />
        </button>
        <div style={{ width: 240 }}>
          <input type="date" className="sp-input " aria-label={L.dateAria} title={L.dateTitle} value={date} onChange={(e) => reset(() => setDate(e.target.value))} />
        </div>
        <Link href="/sales/returns/create" className="sp-btn sp-btn--primary">
          <Icon name="plus" size={18} />
          {L.create}
        </Link>
      </div>

      {showFilters && (
        <div className="sp-card" data-testid="return-filters" style={{ padding: 16, marginBottom: 16, display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="sp-field" style={{ width: 240 }}>
            <label className="sp-label" htmlFor="rf-customer">
              {L.customer}
            </label>
            <select id="rf-customer" className="sp-select " value={customer} onChange={(e) => reset(() => setCustomer(e.target.value))}>
              <option value="ALL">{L.allCustomers}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sp-field" style={{ width: 200 }}>
            <label className="sp-label" htmlFor="rf-sale">
              {L.saleRef}
            </label>
            <input id="rf-sale" className="sp-input " placeholder={L.salePh} dir="ltr" value={sale} onChange={(e) => reset(() => setSale(e.target.value))} />
          </div>
          <button type="button" className="sp-btn sp-btn--secondary" onClick={clear} disabled={!filtering}>
            {L.clear}
          </button>
        </div>
      )}

      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table">
            <thead>
              <tr>
                <th>{L.reference}</th>
                <th>{L.customer}</th>
                <th>{L.warehouse}</th>
                <th>{L.status}</th>
                <th className="num">{L.grandTotal}</th>
                <th className="num">{L.paid}</th>
                <th>{L.paymentStatus}</th>
                <th>{L.createdOn}</th>
                <th className="act">{L.action}</th>
              </tr>
            </thead>
            <tbody>
              {p.visible.map((r) => (
                <tr key={r.id} data-ref={r.reference}>
                  <td>
                    <span className="sp-code">{r.reference}</span>
                    <div className="t-caption" style={{ marginTop: 4 }}>
                      {fmt(L.fromSale, { sale: r.saleRef, date: r.dateLabel })}
                    </div>
                  </td>
                  <td className="primary-cell">{r.customer}</td>
                  <td>{r.warehouse}</td>
                  <td>
                    <span className="sp-badge sp-badge--success" data-status="COMPLETED">
                      <i />
                      {T.sales.status.COMPLETED}
                    </span>
                  </td>
                  <td className="num" data-col="total">{formatMoney(r.grandTotal, r.currency)}</td>
                  <td className="num" data-col="paid" title={L.paidTitle}>{formatMoney("0.00", r.currency)}</td>
                  <td>
                    <span className="sp-badge sp-badge--primary" title={fmt(L.creditTitle, { sale: r.saleRef })}>
                      {L.saleCredit}
                    </span>
                  </td>
                  <td>
                    <span className="sp-badge sp-badge--info">{r.createdOn}</span>
                  </td>
                  <td className="act">
                    <RowMenu
                      label={r.reference}
                      items={[
                        { label: L.view, icon: "eye", href: `/sales/returns/${encodeURIComponent(r.id)}` },
                        { label: L.pdf, icon: "file-down", disabled: T.sales.pdfSoon },
                        { label: L.edit, icon: "pencil", disabled: R.immutable },
                        "-",
                        { label: L.delete, icon: "trash-2", danger: true, disabled: R.immutable },
                      ]}
                    />
                  </td>
                </tr>
              ))}
              {p.visible.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", color: "var(--text-2)" }} data-testid="empty">
                    {rows.length === 0 ? (
                      <span>
                        <b style={{ color: "var(--text-1)" }}>{L.emptyTitle}</b> — {L.emptyHint}
                      </span>
                    ) : (
                      <span>
                        {L.emptyFiltered}{" "}
                        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={clear}>
                          {L.clear}
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr data-testid="totals" style={{ fontWeight: 700 }}>
                  <td colSpan={4} title={mixed ? L.totalMixed : undefined}>
                    {mixed ? fmt(L.totalCur, { code: currency?.code ?? "" }) : L.total}
                  </td>
                  <td className="num" data-testid="total-amount">{formatMoney(total, currency)}</td>
                  <td className="num">{formatMoney("0.00", currency)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <Pagination page={p.current} last={p.last} pageSize={size} from={p.from} to={p.to} total={p.total} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} />
      </div>
    </>
  );
}
