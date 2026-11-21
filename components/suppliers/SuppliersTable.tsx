"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { ConfirmDeleteModal } from "@/components/ui/Modal";
import Pagination, { paginate } from "@/components/ui/Pagination";
import { deleteSupplier } from "@/app/(dashboard)/suppliers/actions";
import type { SupplierRow } from "@/lib/suppliers";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";

// Port of design/Suppliers.html: TableToolbar (search + Import Suppliers + Create Supplier),
// DataTable (Supplier = name + email / Phone Number / Created On / Action), Pagination and
// ConfirmDeleteModal. Search/paging run over the server-loaded list.
//
// Deferred design controls (shown, but not functional yet — no links to unbuilt pages):
// - Import Suppliers: CSV import is not implemented ("Coming soon").
// Account Statement links to /suppliers/statement for OWNER/ADMIN (it shows purchase and payment
// amounts); USER sees it disabled with an explanation.

export default function SuppliersTable({ rows, canManage, canViewStatement }: { rows: SupplierRow[]; canManage: boolean; canViewStatement: boolean }) {
  const router = useRouter();
  const T = useT();
  const S = T.suppliers.list;
  const IMPORT_SOON = S.importSoon;
  const STATEMENT_DENIED = S.statementDenied;
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [del, setDel] = useState<SupplierRow | null>(null);
  const [pending, startTransition] = useTransition();

  const needle = q.trim().toLowerCase();
  const filtered = needle ? rows.filter((r) => (r.name + " " + r.email + " " + r.phoneNumber).toLowerCase().includes(needle)) : rows;
  const p = paginate(filtered, page, pageSize);

  function confirmDelete() {
    const row = del;
    if (!row) return;
    startTransition(async () => {
      try {
        const r = await deleteSupplier(row.id);
        setDel(null);
        if (!r.ok) {
          toast.error(r.message, { id: "supplier" });
          return;
        }
        toast.success(r.message, { id: "supplier" });
        router.refresh();
      } catch {
        toast.error(T.common.somethingWrong, { id: "supplier" });
      }
    });
  }

  const comingSoon = (message: string) => toast(message, { id: "supplier-soon", icon: "ℹ️" });
  const disabledStyle = { opacity: 0.5, cursor: "not-allowed" } as const;

  return (
    <>
      <div className="sp-toolbar">
        <div className="sp-group">
          <Icon name="search" size={18} className="sp-input-icon" />
          <input
            className="sp-input "
            placeholder={S.search}
            aria-label={S.searchAria}
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
            {/* aria-disabled (not disabled) keeps it focusable so the explanation can be read/shown. */}
            <button
              type="button"
              className="sp-btn sp-btn--secondary"
              aria-disabled="true"
              title={IMPORT_SOON}
              style={disabledStyle}
              onClick={() => comingSoon(IMPORT_SOON)}
            >
              <Icon name="upload" size={18} />
              {S.importBtn}
            </button>
            <Link href="/suppliers/create" className="sp-btn sp-btn--primary">
              <Icon name="plus" size={18} />
              {S.create}
            </Link>
          </>
        )}
      </div>

      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table">
            <thead>
              <tr>
                <th>{S.colSupplier}</th>
                <th>{S.colPhone}</th>
                <th>{S.colCreated}</th>
                <th className="num">{S.colAction}</th>
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
                  <td>
                    <span className="sp-badge sp-badge--info">{r.createdOn}</span>
                  </td>
                  <td className="num">
                    <span style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                      {canViewStatement ? (
                        <Link
                          href={`/suppliers/statement?supplier=${encodeURIComponent(r.id)}`}
                          className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
                          aria-label={fmt(S.statementAria, { name: r.name })}
                          title={S.statementTitle}
                          style={{ color: "var(--primary-600)" }}
                        >
                          <Icon name="file-text" size={16} />
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
                          aria-label={fmt(S.statementDeniedAria, { name: r.name })}
                          aria-disabled="true"
                          title={STATEMENT_DENIED}
                          style={{ color: "var(--primary-600)", ...disabledStyle }}
                          onClick={() => comingSoon(STATEMENT_DENIED)}
                        >
                          <Icon name="file-text" size={16} />
                        </button>
                      )}
                      {canManage && (
                        <>
                          <Link
                            href={`/suppliers/${encodeURIComponent(r.id)}/edit`}
                            className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
                            aria-label={fmt(S.editAria, { name: r.name })}
                            style={{ color: "var(--primary-600)" }}
                          >
                            <Icon name="pencil" size={16} />
                          </Link>
                          <button
                            type="button"
                            className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
                            aria-label={fmt(S.deleteAria, { name: r.name })}
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
                  <td colSpan={4} style={{ textAlign: "center", color: "var(--text-2)" }}>
                    {rows.length === 0 ? (
                      <span>
                        <b style={{ color: "var(--text-1)" }}>{S.emptyTitle}</b>
                        {canManage ? S.emptyHint : S.emptyNoManage}
                      </span>
                    ) : (
                      S.noMatch
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
        <ConfirmDeleteModal itemType={S.deleteType} itemName={del.name} busy={pending} onCancel={() => setDel(null)} onConfirm={confirmDelete} />
      )}
    </>
  );
}
