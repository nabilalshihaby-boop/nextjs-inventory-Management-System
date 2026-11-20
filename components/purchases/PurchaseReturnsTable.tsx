"use client";

import Link from "next/link";
import { useState } from "react";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import Pagination, { paginate } from "@/components/ui/Pagination";
import RowMenu from "@/components/ui/RowMenu";
import { formatMoney } from "@/lib/money";
import type { PurchaseReturnRow } from "@/lib/purchase-returns";

// Port of design/Purchases Returns.html: TableToolbar (search, Filter, date, Create Purchase
// Return), DataTable (Reference / Supplier / Warehouse / Status / Grand Total / Paid / Due /
// Payment Type / Created On) with a row menu, and Pagination. Every return is Completed and
// immutable. "Paid" = refunded by the supplier (no supplier payments yet → 0); the return value is
// credited against the original purchase's due, so nothing is outstanding on the return itself.
// Deferred (disabled, "coming soon"): Filter, Download PDF, Edit, Delete.
const SOON = {
  filter: "Advanced return filters are coming soon.",
  pdf: "Download PDF — coming soon",
  edit: "Edit Purchases Return — coming soon (returns are immutable)",
  del: "Delete Purchases Return — coming soon (returns are immutable)",
};
type Currency = { code: string; symbol: string; right: boolean };

export default function PurchaseReturnsTable({ rows }: { rows: PurchaseReturnRow[] }) {
  const [q, setQ] = useState("");
  const [date, setDate] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);

  const needle = q.trim().toLowerCase();
  const filtered = rows.filter((r) => (!needle || [r.reference, r.purchaseRef, r.supplier, r.warehouse].join(" ").toLowerCase().includes(needle)) && (!date || r.date === date));
  const p = paginate(filtered, page, size);
  const money = (v: string, c: Currency) => formatMoney(v, c);

  return (
    <>
      <div className="sp-toolbar">
        <div className="sp-group">
          <Icon name="search" size={18} className="sp-input-icon" />
          <input className="sp-input " placeholder="Search" aria-label="Search purchase returns" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <div className="sp-grow" />
        <button type="button" className="sp-btn sp-btn--secondary sp-btn--icon" aria-label="Filter (coming soon)" aria-disabled="true" title={SOON.filter} style={{ opacity: 0.5, cursor: "not-allowed" }} onClick={() => toast(SOON.filter, { id: "returns-soon", icon: "ℹ️" })}>
          <Icon name="filter" size={18} />
        </button>
        <div style={{ width: 240 }}>
          <input type="date" className="sp-input " aria-label="Select Date" title="Show returns dated on this day" value={date} onChange={(e) => { setDate(e.target.value); setPage(1); }} />
        </div>
        <Link href="/purchases/returns/create" className="sp-btn sp-btn--primary">
          <Icon name="plus" size={18} />
          Create Purchase Return
        </Link>
      </div>

      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Supplier</th>
                <th>Warehouse</th>
                <th>Status</th>
                <th className="num">Grand Total</th>
                <th className="num">Paid</th>
                <th className="num">Due</th>
                <th>Payment Type</th>
                <th>Created On</th>
                <th className="act">Action</th>
              </tr>
            </thead>
            <tbody>
              {p.visible.map((r) => (
                <tr key={r.id} data-ref={r.reference}>
                  <td>
                    <span className="sp-code">{r.reference}</span>
                    <div className="t-caption" style={{ marginTop: 4 }}>
                      From {r.purchaseRef}
                    </div>
                  </td>
                  <td className="primary-cell">{r.supplier}</td>
                  <td>{r.warehouse}</td>
                  <td>
                    <span className="sp-badge sp-badge--success" data-status="COMPLETED">
                      <i />
                      Completed
                    </span>
                  </td>
                  <td className="num" data-col="total">{money(r.grandTotal, r.currency)}</td>
                  <td className="num" data-col="paid" title="Refunded by the supplier (supplier refunds aren't available yet)">{money("0.00", r.currency)}</td>
                  <td className="num" data-col="due" title={`Credited against the due of ${r.purchaseRef}`}>{money("0.00", r.currency)}</td>
                  <td>
                    <span className="sp-badge sp-badge--primary" title={`The return value reduced the unpaid balance of ${r.purchaseRef}`}>
                      Purchase credit
                    </span>
                  </td>
                  <td>
                    <span className="sp-badge sp-badge--info">{r.createdOn}</span>
                  </td>
                  <td className="act">
                    <RowMenu
                      label={r.reference}
                      items={[
                        { label: "View Purchases Return", icon: "eye", href: `/purchases/returns/${encodeURIComponent(r.id)}` },
                        { label: "Download PDF", icon: "file-down", disabled: SOON.pdf },
                        { label: "Edit Purchases Return", icon: "pencil", disabled: SOON.edit },
                        "-",
                        { label: "Delete Purchases Return", icon: "trash-2", danger: true, disabled: SOON.del },
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
                        <b style={{ color: "var(--text-1)" }}>No purchase returns yet</b> — use Create Purchase Return to send received goods back to a supplier.
                      </span>
                    ) : (
                      "No purchase returns match your search."
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={p.current} last={p.last} pageSize={size} from={p.from} to={p.to} total={p.total} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} />
      </div>
    </>
  );
}
