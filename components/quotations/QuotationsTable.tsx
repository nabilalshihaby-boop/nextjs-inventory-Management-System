"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { ConfirmDeleteModal } from "@/components/ui/Modal";
import Pagination, { paginate } from "@/components/ui/Pagination";
import RowMenu from "@/components/ui/RowMenu";
import { deleteQuotation } from "@/app/(dashboard)/quotations/actions";
import { convertQuotationToSale } from "@/app/(dashboard)/sales/actions";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import { tr } from "@/lib/i18n/messages";
import { formatMoney } from "@/lib/money";
import { fromUnits, toUnits } from "@/lib/transfers";
import { convertBlockedReason, QUOTATION_STATUSES, QUOTATION_STATUS_TONE, isEditable, type QuotationCurrency, type QuotationRow, type QuotationStatusValue } from "@/lib/quotations";

// Port of design/Quotations.html: TableToolbar (search, Filter, date, Create Quotation), DataTable
// (Reference / Customer / Warehouse / Status / Grand Total / Created On) with a Grand Total footer, the
// row menu (View / Download PDF / Create Sale / Edit / Delete) and Pagination. The Filter button
// opens Status + Customer filters. Edit/Delete are available for Draft quotations only. Create Sale
// converts an Accepted, not-yet-converted quotation into a Pending sale (server-side, once only);
// otherwise it is disabled with the reason. Download PDF is deferred (disabled).

export default function QuotationsTable({ rows, customers, currency }: { rows: QuotationRow[]; customers: { id: string; name: string }[]; currency: QuotationCurrency | null }) {
  const router = useRouter();
  const T = useT();
  const Q = T.quotations;
  const L = Q.list;
  const [q, setQ] = useState("");
  const [date, setDate] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [status, setStatus] = useState<QuotationStatusValue | "ALL">("ALL");
  const [customer, setCustomer] = useState("ALL");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [del, setDel] = useState<QuotationRow | null>(null);
  const [pending, startTransition] = useTransition();

  const needle = q.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (!needle || [r.reference, r.customer, r.warehouse, Q.status[r.status]].join(" ").toLowerCase().includes(needle)) &&
      (!date || r.date === date) &&
      (status === "ALL" || r.status === status) &&
      (customer === "ALL" || r.customerId === customer),
  );
  const activeFilters = (status !== "ALL" ? 1 : 0) + (customer !== "ALL" ? 1 : 0);
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
    setStatus("ALL");
    setCustomer("ALL");
    setPage(1);
  };

  function convert(row: QuotationRow) {
    startTransition(async () => {
      try {
        const r = await convertQuotationToSale(row.id);
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

  function confirmDelete() {
    const row = del;
    if (!row) return;
    startTransition(async () => {
      try {
        const r = await deleteQuotation(row.id);
        setDel(null);
        if (!r.ok) return void toast.error(r.message, { id: "quotation" });
        toast.success(r.message, { id: "quotation" });
        router.refresh();
      } catch {
        toast.error(T.common.somethingWrong, { id: "quotation" });
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
        <Link href="/quotations/create" className="sp-btn sp-btn--primary">
          <Icon name="plus" size={18} />
          {L.create}
        </Link>
      </div>

      {showFilters && (
        <div className="sp-card" data-testid="quotation-filters" style={{ padding: 16, marginBottom: 16, display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="sp-field" style={{ width: 200 }}>
            <label className="sp-label" htmlFor="qf-status">
              {L.status}
            </label>
            <select id="qf-status" className="sp-select " value={status} onChange={(e) => reset(() => setStatus(e.target.value as QuotationStatusValue | "ALL"))}>
              <option value="ALL">{L.allStatuses}</option>
              {QUOTATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {Q.status[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="sp-field" style={{ width: 240 }}>
            <label className="sp-label" htmlFor="qf-customer">
              {L.customer}
            </label>
            <select id="qf-customer" className="sp-select " value={customer} onChange={(e) => reset(() => setCustomer(e.target.value))}>
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
                <th>{L.createdOn}</th>
                <th className="act">{L.action}</th>
              </tr>
            </thead>
            <tbody>
              {p.visible.map((r) => {
                const draft = isEditable(r.status);
                return (
                  <tr key={r.id} data-ref={r.reference}>
                    <td>
                      <span className="sp-code">{r.reference}</span>
                      <div className="t-caption" style={{ marginTop: 4 }}>
                        {r.dateLabel}
                      </div>
                    </td>
                    <td className="primary-cell">{r.customer}</td>
                    <td>{r.warehouse}</td>
                    <td>
                      <span className={`sp-badge sp-badge--${QUOTATION_STATUS_TONE[r.status]}`} data-status={r.status}>
                        <i />
                        {Q.status[r.status]}
                      </span>
                    </td>
                    <td className="num" data-col="total">{formatMoney(r.grandTotal, r.currency)}</td>
                    <td>
                      <span className="sp-badge sp-badge--info">{r.createdOn}</span>
                    </td>
                    <td className="act">
                      <RowMenu
                        label={r.reference}
                        items={[
                          { label: L.viewQuotation, icon: "eye", href: `/quotations/${encodeURIComponent(r.id)}` },
                          { label: L.downloadPdf, icon: "file-down", disabled: T.sales.pdfSoon },
                          convertBlockedReason(r.status, r.sale?.reference ?? null)
                            ? { label: L.createSale, icon: "shopping-cart", disabled: tr(T, convertBlockedReason(r.status, r.sale?.reference ?? null)!.key, convertBlockedReason(r.status, r.sale?.reference ?? null)!.vars) }
                            : { label: L.createSale, icon: "shopping-cart", onClick: () => convert(r) },
                          draft ? { label: L.editQuotation, icon: "pencil", href: `/quotations/${encodeURIComponent(r.id)}/edit` } : { label: L.editQuotation, icon: "pencil", disabled: Q.block.noEdit },
                          "-",
                          draft ? { label: L.deleteQuotation, icon: "trash-2", danger: true, onClick: () => setDel(r) } : { label: L.deleteQuotation, icon: "trash-2", danger: true, disabled: Q.block.noDelete },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
              {p.visible.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--text-2)" }} data-testid="empty">
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
                  <td colSpan={2} />
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
