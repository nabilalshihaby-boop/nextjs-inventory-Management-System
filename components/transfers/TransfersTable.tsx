"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { ConfirmDeleteModal } from "@/components/ui/Modal";
import Pagination, { paginate } from "@/components/ui/Pagination";
import { deleteTransfer } from "@/app/(dashboard)/transfers/actions";
import { STATUS_LABEL, STATUS_TONE, type TransferRow } from "@/lib/transfers";

// Port of design/Transfers.html: TableToolbar (search, Filter, Create Transfer), DataTable
// (Reference / From Warehouse / To Warehouse / Items / Grand Total / Status / Created On / Action),
// Pagination and ConfirmDeleteModal. Search/paging run over the server-loaded list. View is for
// every role; Edit/Delete only for OWNER/ADMIN on PENDING transfers. Grand Total (cost) is hidden
// from USER. The design's row checkboxes are omitted (there are no bulk actions).
const SOON = "Transfer filters are coming soon.";

export default function TransfersTable({ rows, canManage }: { rows: TransferRow[]; canManage: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [del, setDel] = useState<TransferRow | null>(null);
  const [pending, startTransition] = useTransition();

  const needle = q.trim().toLowerCase();
  const filtered = needle ? rows.filter((r) => [r.reference, r.from, r.to, STATUS_LABEL[r.status]].join(" ").toLowerCase().includes(needle)) : rows;
  const p = paginate(filtered, page, pageSize);
  const cols = canManage ? 8 : 7;

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
        toast.error("Something went wrong. Please try again.", { id: "transfer" });
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
            placeholder="Search"
            aria-label="Search transfers"
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
              aria-label="Filter (coming soon)"
              aria-disabled="true"
              title={SOON}
              style={{ opacity: 0.5, cursor: "not-allowed" }}
              onClick={() => toast(SOON, { id: "transfers-soon", icon: "ℹ️" })}
            >
              <Icon name="filter" size={18} />
            </button>
            <Link href="/transfers/create" className="sp-btn sp-btn--primary">
              <Icon name="plus" size={18} />
              Create Transfer
            </Link>
          </>
        )}
      </div>

      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>From Warehouse</th>
                <th>To Warehouse</th>
                <th>Items</th>
                {canManage && <th className="num">Grand Total</th>}
                <th>Status</th>
                <th>Created On</th>
                <th className="act">Action</th>
              </tr>
            </thead>
            <tbody>
              {p.visible.map((r) => (
                <tr key={r.id} data-ref={r.reference}>
                  <td>
                    <span className="sp-code">{r.reference}</span>
                  </td>
                  <td>{r.from}</td>
                  <td>{r.to}</td>
                  <td>{r.items}</td>
                  {canManage && <td className="num">{r.total}</td>}
                  <td>
                    <span className={`sp-badge sp-badge--${STATUS_TONE[r.status]}`} data-status={r.status}>
                      <i />
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td>
                    <span className="sp-badge sp-badge--info">{r.createdOn}</span>
                  </td>
                  <td className="act">
                    <span style={{ display: "flex", gap: 2 }}>
                      <Link href={`/transfers/${encodeURIComponent(r.id)}`} className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={`View ${r.reference}`}>
                        <Icon name="eye" size={16} />
                      </Link>
                      {canManage && r.status === "PENDING" && (
                        <>
                          <Link href={`/transfers/${encodeURIComponent(r.id)}/edit`} className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={`Edit ${r.reference}`}>
                            <Icon name="pencil" size={16} />
                          </Link>
                          <button
                            type="button"
                            className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
                            aria-label={`Delete ${r.reference}`}
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
                        <b style={{ color: "var(--text-1)" }}>No transfers yet</b>
                        {canManage ? " — use Create Transfer to move stock between warehouses." : "."}
                      </span>
                    ) : (
                      "No transfers match your search."
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
        <ConfirmDeleteModal itemType="transfer" itemName={del.reference} busy={pending} onCancel={() => setDel(null)} onConfirm={confirmDelete} />
      )}
    </>
  );
}
