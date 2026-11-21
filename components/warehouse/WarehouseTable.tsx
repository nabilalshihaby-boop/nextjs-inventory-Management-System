"use client";

import Link from "next/link";
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import Modal, { ConfirmDeleteModal } from "@/components/ui/Modal";
import Pagination, { paginate } from "@/components/ui/Pagination";
import { deleteWarehouse } from "@/app/(dashboard)/warehouse/actions";
import type { WarehouseRow } from "@/lib/warehouses";

// Port of design/Warehouse.html: TableToolbar (search + Create Warehouse), DataTable
// (Warehouse / Phone Number / Country / City / Zip Code / Created On / Action), Pagination,
// View details modal and ConfirmDeleteModal. Search/paging run over the server-loaded list.

export default function WarehouseTable({ rows, canManage }: { rows: WarehouseRow[]; canManage: boolean }) {
  const router = useRouter();
  const T = useT();
  const L = T.warehouses.list;
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [view, setView] = useState<WarehouseRow | null>(null);
  const [del, setDel] = useState<WarehouseRow | null>(null);
  const [pending, startTransition] = useTransition();

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? rows.filter((r) =>
        [r.name, r.email, r.phoneNumber, r.countryName, r.countryCode, r.city, r.zipCode].join(" ").toLowerCase().includes(needle),
      )
    : rows;
  const p = paginate(filtered, page, pageSize);

  function confirmDelete() {
    const row = del;
    if (!row) return;
    startTransition(async () => {
      try {
        const r = await deleteWarehouse(row.id);
        setDel(null);
        if (!r.ok) {
          toast.error(r.message, { id: "warehouse" });
          return;
        }
        toast.success(r.message, { id: "warehouse" });
        router.refresh();
      } catch {
        toast.error(T.common.somethingWrong, { id: "warehouse" });
      }
    });
  }

  const cols = 7; // the Action column always shows (View is available to every role)

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
          <Link href="/warehouse/create" className="sp-btn sp-btn--primary">
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
                <th>{L.colWarehouse}</th>
                <th>{L.colPhone}</th>
                <th>{L.colCountry}</th>
                <th>{L.colCity}</th>
                <th>{L.colZip}</th>
                <th>{L.colCreated}</th>
                <th className="num">{L.colAction}</th>
              </tr>
            </thead>
            <tbody>
              {p.visible.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div style={{ padding: "6px 0" }}>
                      <div style={{ color: "var(--primary-700)", fontWeight: 600 }}>{r.name}</div>
                      <div style={{ color: "var(--text-2)" }}><bdi dir="ltr">{r.email}</bdi></div>
                    </div>
                  </td>
                  <td><bdi dir="ltr">{r.phoneNumber}</bdi></td>
                  <td>{r.countryName}</td>
                  <td>{r.city}</td>
                  <td><bdi dir="ltr">{r.zipCode}</bdi></td>
                  <td>
                    <span className="sp-badge sp-badge--info">{r.createdOn}</span>
                  </td>
                  <td className="num">
                    <span style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
                        aria-label={fmt(L.viewAria, { name: r.name })}
                        style={{ color: "var(--success-500)" }}
                        onClick={() => setView(r)}
                      >
                        <Icon name="eye" size={16} />
                      </button>
                      {canManage && (
                        <>
                          <Link
                            href={`/warehouse/${encodeURIComponent(r.id)}/edit`}
                            className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
                            aria-label={fmt(L.editAria, { name: r.name })}
                            style={{ color: "var(--primary-600)" }}
                          >
                            <Icon name="pencil" size={16} />
                          </Link>
                          <button
                            type="button"
                            className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
                            aria-label={fmt(L.deleteAria, { name: r.name })}
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

      {view && (
        <Modal
          title={view.name}
          onClose={() => setView(null)}
          footer={
            <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setView(null)}>
              {L.close}
            </button>
          }
        >
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "12px 24px", font: "400 14px/20px var(--font-body)" }}>
            {(
              [
                [L.email, view.email, true],
                [L.colPhone, view.phoneNumber, true],
                [L.colCountry, view.countryName, false],
                [L.colCity, view.city, false],
                [L.colZip, view.zipCode, true],
                [L.colCreated, view.createdOn, true],
              ] as const
            ).map(([k, x, ltr]) => (
              <Fragment key={k}>
                <span style={{ color: "var(--text-3)" }}>{k}</span>
                <span style={{ fontWeight: 600 }}>{ltr ? <bdi dir="ltr">{x}</bdi> : x}</span>
              </Fragment>
            ))}
          </div>
        </Modal>
      )}

      {del && canManage && (
        <ConfirmDeleteModal itemType={L.deleteType} itemName={del.name} busy={pending} onCancel={() => setDel(null)} onConfirm={confirmDelete} />
      )}
    </>
  );
}
