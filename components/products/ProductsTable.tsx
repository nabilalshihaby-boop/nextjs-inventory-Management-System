"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import Pagination, { paginate } from "@/components/ui/Pagination";
import RowMenu from "@/components/ui/RowMenu";
import ProductRemovalDialog, { type RemovalKind } from "@/components/products/ProductRemovalDialog";
import { fmt } from "@/lib/i18n/config";
import type { ProductRow } from "@/lib/products";

// Port of design/Products.html: TableToolbar (Filter / Export / Import / Create Product),
// DataTable (checkbox / Product image / Name / Code / Brand / Price / Product Unit / In Stock / Status / Created On)
// and Pagination, plus a row menu (View for everyone; Edit, Activate/Deactivate, Remove for product managers). Search, the status filter and
// paging run over the server-loaded list (default: Active products). Selection survives paging; changing the search or the status filter
// clears it, so a bulk action never touches rows the user cannot see. Removal always asks the server what would happen first.
// Filter and Export are deferred ("Coming soon").

export default function ProductsTable({ rows, canManage, canRemove }: { rows: ProductRow[]; canManage: boolean; canRemove: boolean }) {
  const T = useT();
  const L = T.products.list;
  const SOON = { filter: L.soonFilter, export: L.soonExport };
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ kind: RemovalKind; ids: string[] } | null>(null);
  const S = T.products.status;

  const needle = q.trim().toLowerCase();
  const byStatus = status === "all" ? rows : rows.filter((r) => (status === "active" ? r.active : !r.active));
  const filtered = needle ? byStatus.filter((r) => [r.name, r.code, ...r.barcodes, r.brand, r.unit, r.family ?? "", r.variant].join(" ").toLowerCase().includes(needle)) : byStatus;
  const p = paginate(filtered, page, pageSize);
  const pageIds = p.visible.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPage = pageIds.some((id) => selected.has(id));
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someOnPage && !allOnPage;
  }, [someOnPage, allOnPage]);
  const toggle = (id: string) => setSelected((s0) => { const n = new Set(s0); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const togglePage = () => setSelected((s0) => { const n = new Set(s0); if (allOnPage) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id)); return n; });
  const names = Object.fromEntries(rows.map((r) => [r.id, { name: r.name, code: r.code }]));
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const open = (kind: RemovalKind, ids: string[]) => setDialog({ kind, ids });
  const soon = (m: string) => toast(m, { id: "products-soon", icon: "ℹ️" });
  const disabled = { opacity: 0.5, cursor: "not-allowed" } as const;
  const cols = canManage ? 11 : 9;

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
              setSelected(new Set());
            }}
          />
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span>{S.filterLabel}</span>
          <select
            className="sp-select"
            id="pl-status"
            aria-label={S.filterLabel}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as "active" | "inactive" | "all");
              setPage(1);
              setSelected(new Set());
            }}
            data-testid="status-filter"
          >
            <option value="active">{S.filterActive}</option>
            <option value="inactive">{S.filterInactive}</option>
            <option value="all">{S.filterAll}</option>
          </select>
        </label>
        <div className="sp-grow" />
        {canManage && (
          <>
            {/* aria-disabled (not disabled) keeps them focusable so the explanation can be read/shown. */}
            <button type="button" className="sp-btn sp-btn--secondary sp-btn--icon" aria-label={L.filterAria} aria-disabled="true" title={SOON.filter} style={disabled} onClick={() => soon(SOON.filter)}>
              <Icon name="filter" size={18} />
            </button>
            <button type="button" className="sp-btn sp-btn--secondary" aria-disabled="true" title={SOON.export} style={disabled} onClick={() => soon(SOON.export)}>
              <Icon name="upload" size={18} />
              {L.export}
            </button>
            <Link href="/products/import" className="sp-btn sp-btn--secondary" data-testid="products-import">
              <Icon name="download" size={18} />
              {L.import}
            </Link>
            <Link href="/products/create" className="sp-btn sp-btn--primary">
              <Icon name="plus" size={18} />
              {L.create}
            </Link>
          </>
        )}
      </div>

      {canManage && selected.size > 0 && (
        <div className="sp-toolbar" role="group" aria-label={S.bulkLabel} data-testid="bulk-bar" style={{ flexWrap: "wrap" }}>
          <b data-testid="bulk-count">{fmt(S.selected, { n: selected.size })}</b>
          <button type="button" className="sp-btn sp-btn--danger sp-btn--sm" disabled={!canRemove} title={canRemove ? undefined : S.noScope} onClick={() => open("remove", [...selected])} data-testid="bulk-remove">
            <Icon name="trash-2" size={16} />
            {S.bulkRemove}
          </button>
          {selectedRows.some((r) => r.active) && (
            <button type="button" className="sp-btn sp-btn--secondary sp-btn--sm" disabled={!canRemove} title={canRemove ? undefined : S.noScope} onClick={() => open("deactivate", selectedRows.filter((r) => r.active).map((r) => r.id))} data-testid="bulk-deactivate">
              {S.bulkDeactivate}
            </button>
          )}
          {selectedRows.some((r) => !r.active) && (
            <button type="button" className="sp-btn sp-btn--secondary sp-btn--sm" disabled={!canRemove} title={canRemove ? undefined : S.noScope} onClick={() => open("activate", selectedRows.filter((r) => !r.active).map((r) => r.id))} data-testid="bulk-activate">
              {S.bulkActivate}
            </button>
          )}
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={() => setSelected(new Set())} data-testid="bulk-clear">
            {S.clear}
          </button>
          {!canRemove && (
            <span className="t-caption" data-testid="no-scope" style={{ whiteSpace: "normal" }}>
              {S.noScope}
            </span>
          )}
        </div>
      )}

      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table">
            <thead>
              <tr>
                {canManage && (
                  <th style={{ width: 36 }}>
                    <input ref={selectAllRef} type="checkbox" aria-label={S.selectAll} checked={allOnPage} onChange={togglePage} disabled={pageIds.length === 0} data-testid="product-select-all" />
                  </th>
                )}
                <th>{L.colProduct}</th>
                <th>{L.colName}</th>
                <th>{L.colCode}</th>
                <th>{L.colBrand}</th>
                <th>{L.colPrice}</th>
                <th>{L.colUnit}</th>
                <th>{L.colStock}</th>
                <th>{S.colStatus}</th>
                <th>{L.colCreated}</th>
                <th className="act">{L.colAction}</th>
              </tr>
            </thead>
            <tbody>
              {p.visible.map((r) => (
                <tr key={r.id} data-code={r.code} data-active={r.active ? "1" : "0"} style={r.active ? undefined : { opacity: 0.75 }}>
                  {canManage && (
                    <td>
                      <input type="checkbox" aria-label={fmt(S.selectRow, { name: r.name })} checked={selected.has(r.id)} onChange={() => toggle(r.id)} data-testid="product-select" />
                    </td>
                  )}
                  <td>
                    {r.image ? (
                      // eslint-disable-next-line @next/next/no-img-element -- runtime upload under /uploads
                      <img src={r.image} alt="" className="sp-thumb" style={{ objectFit: "cover" }} />
                    ) : (
                      <span className="sp-thumb" />
                    )}
                  </td>
                  <td className="primary-cell">
                    {r.name}
                    {r.family && (
                      <div className="sp-sub" data-testid="product-family" style={{ fontSize: 12, fontWeight: 400, color: "var(--text-2)" }}>
                        {r.family} · {r.variant}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="sp-code"><bdi dir="ltr">{r.code}</bdi></span>
                  </td>
                  <td>{r.brand}</td>
                  <td><bdi dir="ltr">{r.price}</bdi></td>
                  <td>
                    <span className="sp-badge sp-badge--neutral">{r.unit}</span>
                  </td>
                  <td>
                    <b style={{ fontWeight: 600, color: r.lowStock ? "var(--danger-700)" : undefined }} title={r.lowStock ? L.lowStock : undefined}>
                      <bdi dir="ltr">{r.inStock}</bdi>
                    </b>
                  </td>
                  <td>
                    <span className={"sp-badge " + (r.active ? "sp-badge--success" : "sp-badge--neutral")} data-testid="status-badge">
                      {r.active ? S.active : S.inactive}
                    </span>
                  </td>
                  <td>
                    <span className="sp-badge sp-badge--info">{r.createdOn}</span>
                  </td>
                  <td className="act">
                    <RowMenu
                      label={r.name}
                      items={[
                        { label: S.view, icon: "eye", href: `/products/${encodeURIComponent(r.id)}` },
                        ...(canManage
                          ? ([
                              { label: L.edit, icon: "pencil", href: `/products/${encodeURIComponent(r.id)}/edit` },
                              canRemove
                                ? { label: r.active ? S.deactivate : S.activate, icon: r.active ? ("circle-minus" as const) : ("circle-check" as const), onClick: () => open(r.active ? "deactivate" : "activate", [r.id]) }
                                : { label: r.active ? S.deactivate : S.activate, icon: r.active ? ("circle-minus" as const) : ("circle-check" as const), disabled: S.noScope },
                              "-",
                              canRemove ? { label: S.remove, icon: "trash-2" as const, danger: true, onClick: () => open("remove", [r.id]) } : { label: S.remove, icon: "trash-2" as const, danger: true, disabled: S.noScope },
                            ] as const)
                          : []),
                      ]}
                    />
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
                    ) : needle ? (
                      L.noMatch
                    ) : (
                      S.emptyStatus
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
      {dialog && canManage && (
        <ProductRemovalDialog
          kind={dialog.kind}
          ids={dialog.ids}
          names={names}
          canActivate={canRemove}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setSelected(new Set());
          }}
        />
      )}
    </>
  );
}
