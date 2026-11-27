"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { ConfirmDeleteModal } from "@/components/ui/Modal";
import Pagination, { paginate } from "@/components/ui/Pagination";
import { deleteCustomer } from "@/app/(dashboard)/customers/actions";
import type { CustomerRow } from "@/lib/customers";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";

// Port of design/Customers.html: TableToolbar (search + Import Customers + Create Customer),
// DataTable (Customer = name + email / Phone Number / Created On / Action), Pagination and
// ConfirmDeleteModal. Search/paging run over the server-loaded list. Rows don't link anywhere
// Account Statement (OWNER/ADMIN) links to /customers/statement.
// Deferred: Import Customers (CSV import not implemented) — shown disabled, "Coming soon".

export default function CustomersTable({ rows, canManage, canViewStatement }: { rows: CustomerRow[]; canManage: boolean; canViewStatement: boolean }) {
  const router = useRouter();
  const T = useT();
  const C = T.customers;
  const IMPORT_SOON = C.importSoon;
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [del, setDel] = useState<CustomerRow | null>(null);
  const [pending, startTransition] = useTransition();

  const needle = q.trim().toLowerCase();
  const filtered = needle ? rows.filter((r) => [r.name, r.email, r.phoneNumber, r.countryName, r.city].join(" ").toLowerCase().includes(needle)) : rows;
  const p = paginate(filtered, page, pageSize);
  const showActions = canManage || canViewStatement;
  const cols = showActions ? 4 : 3;

  function confirmDelete() {
    const row = del;
    if (!row) return;
    startTransition(async () => {
      try {
        const r = await deleteCustomer(row.id);
        setDel(null);
        if (!r.ok) {
          toast.error(r.message, { id: "customer" });
          return;
        }
        toast.success(r.message, { id: "customer" });
        router.refresh();
      } catch {
        toast.error(T.common.somethingWrong, { id: "customer" });
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
            placeholder={C.search}
            aria-label={C.searchAria}
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
              style={{ opacity: 0.5, cursor: "not-allowed" }}
              onClick={() => toast(IMPORT_SOON, { id: "customer-soon", icon: "ℹ️" })}
            >
              <Icon name="upload" size={18} />
              {C.importBtn}
            </button>
            <Link href="/customers/create" className="sp-btn sp-btn--primary">
              <Icon name="plus" size={18} />
              {C.create}
            </Link>
          </>
        )}
      </div>

      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table">
            <thead>
              <tr>
                <th>{C.colCustomer}</th>
                <th>{C.colPhone}</th>
                <th>{C.colCreated}</th>
                {showActions && <th className="num">{C.colAction}</th>}
              </tr>
            </thead>
            <tbody>
              {p.visible.map((r) => (
                <tr key={r.id} data-name={r.name}>
                  <td>
                    <div style={{ padding: "6px 0" }}>
                      <div style={{ color: "var(--primary-700)", fontWeight: 600 }}>{r.name}</div>
                      <div style={{ color: "var(--text-2)" }}><bdi dir="ltr">{r.email}</bdi></div>
                      <div style={{ color: "var(--text-3)", fontSize: 12.5 }} data-testid="customer-place">
                        {[r.city, r.countryName].filter(Boolean).join(", ")}
                      </div>
                    </div>
                  </td>
                  <td><bdi dir="ltr">{r.phoneNumber}</bdi></td>
                  <td>
                    <span className="sp-badge sp-badge--info">{r.createdOn}</span>
                  </td>
                  {showActions && (
                    <td className="num">
                      <span style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                        {canViewStatement && (
                          <Link
                            href={`/customers/statement?customer=${encodeURIComponent(r.id)}`}
                            className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
                            aria-label={fmt(C.statementAria, { name: r.name })}
                            title={C.statementTitle}
                            style={{ color: "var(--primary-600)" }}
                          >
                            <Icon name="file-text" size={16} />
                          </Link>
                        )}
                        {canManage && (
                        <>
                        <Link
                          href={`/customers/${encodeURIComponent(r.id)}/edit`}
                          className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
                          aria-label={fmt(C.editAria, { name: r.name })}
                          style={{ color: "var(--primary-600)" }}
                        >
                          <Icon name="pencil" size={16} />
                        </Link>
                        <button
                          type="button"
                          className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon"
                          aria-label={fmt(C.deleteAria, { name: r.name })}
                          style={{ color: "var(--danger-500)" }}
                          onClick={() => setDel(r)}
                        >
                          <Icon name="trash-2" size={16} />
                        </button>
                        </>
                        )}
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
                        <b style={{ color: "var(--text-1)" }}>{C.emptyTitle}</b>
                        {canManage ? C.emptyHint : C.emptyNoManage}
                      </span>
                    ) : (
                      C.noMatch
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
        <ConfirmDeleteModal itemType={C.deleteType} itemName={del.name} busy={pending} onCancel={() => setDel(null)} onConfirm={confirmDelete} />
      )}
    </>
  );
}
