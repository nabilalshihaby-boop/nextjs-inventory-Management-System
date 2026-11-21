"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { ConfirmDeleteModal } from "@/components/ui/Modal";
import Pagination, { paginate } from "@/components/ui/Pagination";
import RowMenu from "@/components/ui/RowMenu";
import { deleteSale } from "@/app/(dashboard)/sales/actions";
import { formatMoney } from "@/lib/money";
import { fromUnits, toUnits } from "@/lib/transfers";
import { PAYMENT_STATUS_TONE } from "@/lib/purchases";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import { tr } from "@/lib/i18n/messages";
import { SALE_STATUSES, SALE_STATUS_TONE, type SaleCurrency, type SaleRow, type SaleStatusValue } from "@/lib/sales";

// Port of design/Sales.html: TableToolbar (search, Filter, date, Create Sale), DataTable (Reference /
// Customer / Warehouse / Status / Grand Total / Paid / Payment Status / Payment Type / Created On) with
// Grand Total + Paid footer totals, the row menu and Pagination. Filter opens Status + Customer
// filters. Paid = Σ customer-payment allocations; Payment Type lists their methods; Payment Status
// reflects payments and returns (Due = Grand Total − Paid − returns). Show Payments opens the
// customer payments list filtered to the sale. Create Sale Return opens the return form for
// a Completed sale with something returnable and unpaid. Edit/Delete apply to Pending sales only.
// Deferred (disabled with a reason): Download PDF.

export default function SalesTable({ rows, customers, currency }: { rows: SaleRow[]; customers: { id: string; name: string }[]; currency: SaleCurrency | null }) {
  const router = useRouter();
  const T = useT();
  const S = T.sales;
  const L = S.list;
  const [q, setQ] = useState("");
  const [date, setDate] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [status, setStatus] = useState<SaleStatusValue | "ALL">("ALL");
  const [customer, setCustomer] = useState("ALL");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [del, setDel] = useState<SaleRow | null>(null);
  const [pending, startTransition] = useTransition();

  const needle = q.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (!needle || [r.reference, r.customer, r.warehouse, S.status[r.status], r.quotationRef ?? ""].join(" ").toLowerCase().includes(needle)) &&
      (!date || r.date === date) &&
      (status === "ALL" || r.status === status) &&
      (customer === "ALL" || r.customerId === customer),
  );
  const activeFilters = (status !== "ALL" ? 1 : 0) + (customer !== "ALL" ? 1 : 0);
  const filtering = !!needle || !!date || activeFilters > 0;
  const p = paginate(filtered, page, size);
  const sum = (k: "grandTotal" | "paid") => fromUnits(filtered.filter((r) => r.inDefaultCurrency).reduce((a, r) => a + toUnits(r[k], 2), BigInt(0)), 2);
  const mixed = filtered.some((r) => !r.inDefaultCurrency);
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };
  const clear = () => {
    setQ("");
    setDate("");
    setStatus("ALL");
    setCustomer("ALL");
    setPage(1);
  };

  function confirmDelete() {
    const row = del;
    if (!row) return;
    startTransition(async () => {
      try {
        const r = await deleteSale(row.id);
        setDel(null);
        if (!r.ok) return void toast.error(r.message, { id: "sale" });
        toast.success(r.message, { id: "sale" });
        router.refresh();
      } catch {
        toast.error(T.common.somethingWrong, { id: "sale" });
      }
    });
  }

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
        <Link href="/sales/create" className="sp-btn sp-btn--primary">
          <Icon name="plus" size={18} />
          {L.create}
        </Link>
      </div>

      {showFilters && (
        <div className="sp-card" data-testid="sale-filters" style={{ padding: 16, marginBottom: 16, display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="sp-field" style={{ width: 200 }}>
            <label className="sp-label" htmlFor="sf-status">
              {L.status}
            </label>
            <select id="sf-status" className="sp-select " value={status} onChange={(e) => reset(() => setStatus(e.target.value as SaleStatusValue | "ALL"))}>
              <option value="ALL">{L.allStatuses}</option>
              {SALE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {S.status[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="sp-field" style={{ width: 240 }}>
            <label className="sp-label" htmlFor="sf-customer">
              {L.customer}
            </label>
            <select id="sf-customer" className="sp-select " value={customer} onChange={(e) => reset(() => setCustomer(e.target.value))}>
              <option value="ALL">{L.allCustomers}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
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
                <th>{L.paymentType}</th>
                <th>{L.createdOn}</th>
                <th className="act">{L.action}</th>
              </tr>
            </thead>
            <tbody>
              {p.visible.map((r) => {
                const editable = r.status === "PENDING";
                return (
                  <tr key={r.id} data-ref={r.reference}>
                    <td>
                      <span className="sp-code">{r.reference}</span>
                      <div className="t-caption" style={{ marginTop: 4 }}>
                        {r.dateLabel}
                        {r.quotationRef ? ` · ${fmt(L.fromQuotation, { ref: r.quotationRef })}` : ""}
                      </div>
                    </td>
                    <td className="primary-cell">{r.customer}</td>
                    <td>{r.warehouse}</td>
                    <td>
                      <span className={`sp-badge sp-badge--${SALE_STATUS_TONE[r.status]}`} data-status={r.status}>
                        <i />
                        {S.status[r.status]}
                      </span>
                    </td>
                    <td className="num" data-col="total">{formatMoney(r.grandTotal, r.currency)}</td>
                    <td className="num" data-col="paid" title={fmt(L.dueTitle, { amount: formatMoney(r.due, r.currency) })}>{formatMoney(r.paid, r.currency)}</td>
                    <td>
                      <span className={`sp-badge sp-badge--${PAYMENT_STATUS_TONE[r.paymentStatus]}`} data-payment={r.paymentStatus} title={r.returned !== "0.00" ? fmt(L.returnedTitle, { returned: formatMoney(r.returned, r.currency), due: formatMoney(r.due, r.currency) }) : undefined}>
                        <i />
                        {S.payStatus[r.paymentStatus]}
                      </span>
                    </td>
                    <td data-col="payment-type">
                      {r.paymentTypes.length ? (
                        r.paymentTypes.map((t) => (
                          <span key={t} className="sp-badge sp-badge--primary" style={{ marginRight: 4 }}>
                            {(S.methods as Record<string, string>)[t] ?? t}
                          </span>
                        ))
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <span className="sp-badge sp-badge--info">{r.createdOn}</span>
                    </td>
                    <td className="act">
                      <RowMenu
                        label={r.reference}
                        items={[
                          { label: L.viewSale, icon: "eye", href: `/sales/${encodeURIComponent(r.id)}` },
                          { label: L.downloadPdf, icon: "file-down", disabled: S.pdfSoon },
                          r.paid !== "0.00" ? { label: L.showPayments, icon: "dollar-sign", href: `/customer-payments?q=${encodeURIComponent(r.reference)}` } : { label: L.showPayments, icon: "dollar-sign", disabled: S.block.noPayments },
                          r.returnBlocked ? { label: L.createReturn, icon: "undo-2", disabled: tr(T, r.returnBlocked) } : { label: L.createReturn, icon: "undo-2", href: `/sales/returns/create?sale=${encodeURIComponent(r.id)}` },
                          editable ? { label: L.editSale, icon: "pencil", href: `/sales/${encodeURIComponent(r.id)}/edit` } : { label: L.editSale, icon: "pencil", disabled: S.block.noEdit },
                          "-",
                          editable ? { label: L.deleteSale, icon: "trash-2", danger: true, onClick: () => setDel(r) } : { label: L.deleteSale, icon: "trash-2", danger: true, disabled: S.block.noDelete },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
              {p.visible.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", color: "var(--text-2)" }} data-testid="empty">
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
                  <td className="num" data-testid="total-grand">{formatMoney(sum("grandTotal"), currency)}</td>
                  <td className="num" data-testid="total-paid">{formatMoney(sum("paid"), currency)}</td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <Pagination page={p.current} last={p.last} pageSize={size} from={p.from} to={p.to} total={p.total} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} />
      </div>

      {del && <ConfirmDeleteModal itemType={L.deleteType} itemName={del.reference} busy={pending} onCancel={() => setDel(null)} onConfirm={confirmDelete} />}
    </>
  );
}
