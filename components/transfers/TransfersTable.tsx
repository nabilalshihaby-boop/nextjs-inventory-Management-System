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
import { deleteTransfer } from "@/app/(dashboard)/transfers/actions";
import { STATUS_TONE, type TransferRow } from "@/lib/transfers";

// Port of design/Transfers.html: TableToolbar (search, Filter, Create Transfer), DataTable
// (Reference / From Warehouse / To Warehouse / Items / Grand Total / Status / Created On / Action),
// Pagination and ConfirmDeleteModal. Search/paging run over the server-loaded list. View is for
// every role; Edit/Delete only for OWNER/ADMIN on PENDING transfers. Grand Total (cost) is hidden
// from USER. The design's row checkboxes are omitted (there are no bulk actions).

export default function TransfersTable({ rows, canManage, showCost }: { rows: TransferRow[]; canManage: boolean; showCost: boolean }) {
  const router = useRouter();
  const T = useT();
  const L = T.transfers.list;
  const SOON = L.soonFilter;
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [del, setDel] = useState<TransferRow | null>(null);
  const [pending, startTransition] = useTransition();

  const needle = q.trim().toLowerCase();
  const filtered = needle ? rows.filter((r) => [r.reference, r.from, r.to, T.transfers.status[r.status]].join(" ").toLowerCase().includes(needle)) : rows;
  const p = paginate(filtered, page, pageSize);
  const cols = showCost ? 8 : 7;

  function confirmDelete() {
    const row = del;
    if (!row) return;
    startTransition(async () => {
      try {
        const r = await deleteTransfer(row.id);
        setDel(null);
        if (!r.ok) {
          toast.error(r.message, { id: "transfer" });
          router.refresh();
          return;
        }
        toast.success(r.message, { id: "transfer" });
        router.refresh();
      } catch {
        toast.error(T.common.somethingWrong, { id: "transfer" });
      }
    });
  }

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
          <>
            <button
              type="button"
              className="sp-btn sp-btn--secondary sp-btn--icon"
              aria-label={L.filterAria}
              aria-disabled="true"
              title={SOON}
              style={{ opacity: 0.5, cursor: "not-allowed" }}
              onClick={() => toast(SOON, { id: "transfers-soon", icon: "ℹ️" })}
            >
              <Icon name="filter" size={18} />
            </button>
            <Link href="/transfers/create" className="sp-btn sp-btn--primary">
              <Icon name="plus" size={18} />
              {L.create}
            </Link>
          </>
        )}
      </div>

      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table">
            <thead>
              <tr>
                <th>{L.colReference}</th>
                <th>{L.colFrom}</th>
                <th>{L.colTo}</th>
                <th>{L.colItems}</th>
                {showCost && <th className="num">{L.colTotal}</th>}
                <th>{L.colStatus}</th>
                <th>{L.colCreated}</th>
                <th className="act">{L.colAction}</th>
              </tr>
            </thead>
            <tbody>
              {p.visible.map((r) => (
                <tr key={r.id} data-ref={r.reference}>
                  <td>
                    <span className="sp-code"><bdi dir="ltr">{r.reference}</bdi></span>
                  </td>
                  <td>{r.from}</td>
                  <td>{r.to}</td>
                  <td>{r.items}</td>
                  {showCost && <td className="num"><bdi dir="ltr">{r.total}</bdi></td>}
                  <td>
                    <span className={`sp-badge sp-badge--${STATUS_TONE[r.status]}`} data-status={r.status}>
                      <i />
                      {T.transfers.status[r.status]}
                    </span>
                  </td>
                  <td>
                    <span className="sp-badge sp-badge--info">{r.createdOn}</span>
                  </td>
                  <td className="act">
                    <span style={{ display: "flex", gap: 2 }}>
                      <Link href={`/transfers/${encodeURIComponent(r.id)}`} className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={fmt(L.viewAria, { ref: r.reference })}>
                        <Icon name="eye" size={16} />
                      </Link>
                      {canManage && r.status === "PENDING" && (
                        <>
                          <Link href={`/transfers/${encodeURIComponent(r.id)}/edit`} className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={fmt(L.editAria, { ref: r.reference })}>
                            <Icon name="pencil" size={16} />
                          </Link>
                          <button
                            type="button"
                            className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
                            aria-label={fmt(L.deleteAria, { ref: r.reference })}
                            style={{ color: "var(--danger-500)" }}
                            onClick={() => setDel(r)}
                          >
                            <Icon name="trash-2" size={16} />
                          </button>
                        </>
                      )}
                    </span>
                  </td>
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
