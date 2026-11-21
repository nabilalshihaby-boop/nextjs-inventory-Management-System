"use client";

import Link from "next/link";
import { useState } from "react";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import Pagination, { paginate } from "@/components/ui/Pagination";
import RowMenu from "@/components/ui/RowMenu";
import { formatMoney } from "@/lib/money";
import { fromUnits, toUnits } from "@/lib/transfers";
import { PAYMENT_STATUS_TONE, PURCHASE_STATUS_TONE, type PurchaseRow } from "@/lib/purchases";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";

// Port of design/Purchases.html: TableToolbar (search, Filter, date, Create Purchase), DataTable
// (Reference / Supplier / Warehouse / Status / Grand Total / Paid / Due / Payment Status /
// Created On) with a totals footer and a row menu, plus Pagination. Deferred in this step (shown
// disabled with an explanation): Filter, Download PDF, Edit Purchase, Delete Purchase.

type Currency = { code: string; symbol: string; right: boolean };

export default function PurchasesTable({ rows, currency }: { rows: PurchaseRow[]; currency: Currency | null }) {
  const T = useT();
  const P = T.purchases;
  const L = P.list;
  const SOON = P.soon;
  const [q, setQ] = useState("");
  const [date, setDate] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);

  const needle = q.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (!needle || [r.reference, r.supplier, r.warehouse, P.status[r.status], T.sales.payStatus[r.paymentStatus]].join(" ").toLowerCase().includes(needle)) &&
      (!date || r.date === date),
  );
  const p = paginate(filtered, page, size);
  const sum = (k: "grandTotal" | "paid" | "due") => fromUnits(filtered.filter((r) => r.inDefaultCurrency).reduce((a, r) => a + toUnits(r[k], 2), BigInt(0)), 2);
  const mixed = filtered.some((r) => !r.inDefaultCurrency);
  const money = (v: string, c: Currency | null) => formatMoney(v, c);

  return (
    <>
      <div className="sp-toolbar">
        <div className="sp-group">
          <Icon name="search" size={18} className="sp-input-icon" />
          <input className="sp-input " placeholder={L.search} aria-label={L.searchAria} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <div className="sp-grow" />
        <button type="button" className="sp-btn sp-btn--secondary sp-btn--icon" aria-label={L.filterSoonAria} aria-disabled="true" title={SOON.filter} style={{ opacity: 0.5, cursor: "not-allowed" }} onClick={() => toast(SOON.filter, { id: "purchases-soon", icon: "ℹ️" })}>
          <Icon name="filter" size={18} />
        </button>
        <div style={{ width: 240 }}>
          <input type="date" className="sp-input " aria-label={L.dateAria} title={L.dateTitle} value={date} onChange={(e) => { setDate(e.target.value); setPage(1); }} />
        </div>
        <Link href="/purchases/create" className="sp-btn sp-btn--primary">
          <Icon name="plus" size={18} />
          {L.create}
        </Link>
      </div>

      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table">
            <thead>
              <tr>
                <th>{L.reference}</th>
                <th>{L.supplier}</th>
                <th>{L.warehouse}</th>
                <th>{L.status}</th>
                <th className="num">{L.grandTotal}</th>
                <th className="num">{L.paid}</th>
                <th className="num">{L.due}</th>
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
                  </td>
                  <td className="primary-cell">{r.supplier}</td>
                  <td>{r.warehouse}</td>
                  <td>
                    <span className={`sp-badge sp-badge--${PURCHASE_STATUS_TONE[r.status]}`} data-status={r.status}>
                      <i />
                      {P.status[r.status]}
                    </span>
                  </td>
                  <td className="num" data-col="total">{money(r.grandTotal, r.currency)}</td>
                  <td className="num" data-col="paid">{money(r.paid, r.currency)}</td>
                  <td className="num" data-col="due">{money(r.due, r.currency)}</td>
                  <td>
                    <span className={`sp-badge sp-badge--${PAYMENT_STATUS_TONE[r.paymentStatus]}`} data-payment={r.paymentStatus}>
                      <i />
                      {T.sales.payStatus[r.paymentStatus]}
                    </span>
                  </td>
                  <td>
                    <span className="sp-badge sp-badge--info">{r.createdOn}</span>
                  </td>
                  <td className="act">
                    <RowMenu
                      label={r.reference}
                      items={[
                        { label: L.view, icon: "eye", href: `/purchases/${encodeURIComponent(r.id)}` },
                        { label: L.pdf, icon: "file-down", disabled: SOON.pdf },
                        { label: L.edit, icon: "pencil", disabled: SOON.edit },
                        "-",
                        { label: L.delete, icon: "trash-2", danger: true, disabled: SOON.del },
                      ]}
                    />
                  </td>
                </tr>
              ))}
              {p.visible.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", color: "var(--text-2)" }} data-testid="empty">
                    {rows.length === 0 ? (
                      <span>
                        <b style={{ color: "var(--text-1)" }}>{L.emptyTitle}</b> — {L.emptyHint}
                      </span>
                    ) : (
                      L.noMatch
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
                  <td className="num" data-col="total">{money(sum("grandTotal"), currency)}</td>
                  <td className="num" data-col="paid">{money(sum("paid"), currency)}</td>
                  <td className="num" data-col="due">{money(sum("due"), currency)}</td>
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
