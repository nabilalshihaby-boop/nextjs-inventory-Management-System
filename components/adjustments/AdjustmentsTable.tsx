"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import { ConfirmDeleteModal } from "@/components/ui/Modal";
import Pagination, { paginate } from "@/components/ui/Pagination";
import { deleteAdjustment } from "@/app/(dashboard)/adjustments/actions";
import { TYPE_TONE, type AdjustmentRow } from "@/lib/adjustments";

// Port of design/Adjustments.html: TableToolbar (search + Create Adjustment), DataTable
// (Reference / Warehouse / Product / Type / Quantity / Date / Action), Pagination and
// ConfirmDeleteModal. One row per adjustment; an adjustment with several items lists each
// item's product, type and quantity on its own line. Edit/Delete for OWNER/ADMIN only.

export default function AdjustmentsTable({ rows, canManage }: { rows: AdjustmentRow[]; canManage: boolean }) {
  const router = useRouter();
  const T = useT();
  const L = T.adjustments.list;
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [del, setDel] = useState<AdjustmentRow | null>(null);
  const [pending, startTransition] = useTransition();

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? rows.filter((r) => [r.reference, r.warehouse, ...r.lines.flatMap((l) => [l.product, l.code, T.adjustments.type[l.type]])].join(" ").toLowerCase().includes(needle))
    : rows;
  const p = paginate(filtered, page, pageSize);
  const cols = canManage ? 7 : 6;

  function confirmDelete() {
    const row = del;
    if (!row) return;
    startTransition(async () => {
      try {
        const r = await deleteAdjustment(row.id);
        setDel(null);
        if (!r.ok) toast.error(r.message, { id: "adjustment", duration: 6000 });
        else toast.success(r.message, { id: "adjustment" });
        router.refresh();
      } catch {
        toast.error(T.common.somethingWrong, { id: "adjustment" });
      }
    });
  }

  const stack = { display: "flex", flexDirection: "column", gap: 6, padding: "8px 0", alignItems: "flex-start" } as const;

  return (
    <>
      <div className="sp-toolbar">
        <div className="sp-group">
          <Icon name="search" size={18} className="sp-input-icon" />
          <input
            className="sp-input "
            placeholder={L.search}
            aria-label={L.searchAria}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="sp-grow" />
        {canManage && (
          <Link href="/adjustments/create" className="sp-btn sp-btn--primary">
            <Icon name="plus" size={18} />
            {L.create}
          </Link>
        )}
      </div>

      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table">
            <thead>
              <tr>
                <th>{L.colReference}</th>
                <th>{L.colWarehouse}</th>
                <th>{L.colProduct}</th>
                <th>{L.colType}</th>
                <th>{L.colQty}</th>
                <th>{L.colDate}</th>
                {canManage && <th className="num">{L.colAction}</th>}
              </tr>
            </thead>
            <tbody>
              {p.visible.map((r) => (
                <tr key={r.id} data-ref={r.reference}>
                  <td>
                    <span className="sp-code"><bdi dir="ltr">{r.reference}</bdi></span>
                  </td>
                  <td>{r.warehouse}</td>
                  <td className="primary-cell">
                    <div style={stack}>
                      {r.lines.map((l) => (
                        <span key={l.code}>{l.product}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div style={stack}>
                      {r.lines.map((l) => (
                        <span key={l.code} className={`sp-badge sp-badge--${TYPE_TONE[l.type]}`} data-type={l.type}>
                          {T.adjustments.type[l.type]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div style={stack}>
                      {r.lines.map((l) => (
                        <span key={l.code}>
                          <bdi dir="ltr">{l.quantity}</bdi> {l.unit}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span className="sp-badge sp-badge--info">{r.date}</span>
                  </td>
                  {canManage && (
                    <td className="num">
                      <span style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                        <Link href={`/adjustments/${encodeURIComponent(r.id)}/edit`} className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={fmt(L.editAria, { ref: r.reference })} style={{ color: "var(--primary-600)" }}>
                          <Icon name="pencil" size={16} />
                        </Link>
                        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={fmt(L.deleteAria, { ref: r.reference })} style={{ color: "var(--danger-500)" }} onClick={() => setDel(r)}>
                          <Icon name="trash-2" size={16} />
                        </button>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
              {p.visible.length === 0 && (
                <tr>
                  <td colSpan={cols} style={{ textAlign: "center", color: "var(--text-2)" }}>
                    {rows.length === 0 ? (
                      <span>
                        <b style={{ color: "var(--text-1)" }}>{L.emptyTitle}</b>
                        {canManage ? L.emptyHint : "."}
                      </span>
                    ) : (
                      L.noMatch
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={p.current}
          last={p.last}
          pageSize={pageSize}
          from={p.from}
          to={p.to}
          total={p.total}
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      </div>

      {del && canManage && (
        <ConfirmDeleteModal itemType={L.deleteType} itemName={del.reference} busy={pending} onCancel={() => setDel(null)} onConfirm={confirmDelete} />
      )}
    </>
  );
}
