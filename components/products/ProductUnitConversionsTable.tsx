"use client";

import Link from "next/link";
import { useState } from "react";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import Pagination, { paginate } from "@/components/ui/Pagination";
import { fmt } from "@/lib/i18n/config";

export type ProductUnitConversionRow = {
  id: string;
  code: string;
  name: string;
  base: string;
  /** Default sale / purchase unit names. */
  saleUnit: string;
  purchaseUnit: string;
  packs: { unit: string; factor: string; active: boolean }[];
};

// Product Unit Conversions overview: products that have extra Product Units, each with its explicit "1 Box = 6 Piece" relationships and
// default sale / purchase units. Products with only a Base Unit are hidden unless the toggle is on. Conversions are product-specific, so
// editing stays in the Product edit form ("Manage Units" opens its Product Units section). Search/paging run over the filtered list.
export default function ProductUnitConversionsTable({ rows, canManage }: { rows: ProductUnitConversionRow[]; canManage: boolean }) {
  const T = useT();
  const L = T.units.page;
  const [q, setQ] = useState("");
  const [showBaseOnly, setShowBaseOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const withPacks = rows.filter((r) => r.packs.length > 0);
  const scope = showBaseOnly ? rows : withPacks;
  const needle = q.trim().toLowerCase();
  const filtered = needle ? scope.filter((r) => [r.code, r.name, r.base, r.saleUnit, r.purchaseUnit, ...r.packs.map((x) => x.unit)].join(" ").toLowerCase().includes(needle)) : scope;
  const p = paginate(filtered, page, pageSize);
  const cols = 5 + (canManage ? 1 : 0);

  return (
    <>
      <p className="t-caption" style={{ margin: "0 0 12px", color: "var(--text-2)" }}>
        {L.intro}
      </p>
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
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            id="cv-show-base-only"
            checked={showBaseOnly}
            onChange={(e) => {
              setShowBaseOnly(e.target.checked);
              setPage(1);
            }}
            data-testid="show-base-only"
          />
          <span>{L.showBaseOnly}</span>
        </label>
        <div className="sp-grow" />
      </div>
      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table" data-testid="base-units">
            <thead>
              <tr>
                <th>{L.colProduct}</th>
                <th>{L.colBase}</th>
                <th>{L.colUnits}</th>
                <th>{L.colPurchase}</th>
                <th>{L.colSale}</th>
                {canManage && <th className="act">{L.colAction}</th>}
              </tr>
            </thead>
            <tbody>
              {p.visible.map((r) => (
                <tr key={r.id} data-code={r.code}>
                  <td>
                    <span className="primary-cell">{r.name}</span>
                    <div className="sp-sub" style={{ fontSize: 12, color: "var(--text-2)" }}>
                      <bdi dir="ltr">{r.code}</bdi>
                    </div>
                  </td>
                  <td>
                    <span className="sp-badge sp-badge--info">{r.base}</span>
                  </td>
                  <td data-testid="packs">
                    {r.packs.length === 0 ? (
                      <span style={{ color: "var(--text-3)" }} data-testid="base-only">
                        {L.none}
                      </span>
                    ) : (
                      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 4 }}>
                        {r.packs.map((x) => (
                          <li key={x.unit} data-testid="relation" style={x.active ? undefined : { color: "var(--text-3)" }}>
                            <bdi dir="ltr">{fmt(T.units.form.meaning, { unit: x.unit, factor: x.factor, base: r.base })}</bdi>
                            {!x.active && <> · {L.inactive}</>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td data-testid="purchase-unit">{r.purchaseUnit}</td>
                  <td data-testid="sale-unit">{r.saleUnit}</td>
                  {canManage && (
                    <td className="act">
                      <Link
                        href={`/products/${encodeURIComponent(r.id)}/edit#product-units`}
                        className="sp-btn sp-btn--secondary sp-btn--sm"
                        aria-label={fmt(L.manageAria, { name: r.name })}
                        data-testid="manage-units"
                      >
                        <Icon name="pencil" size={16} />
                        {L.manage}
                      </Link>
                    </td>
                  )}
                </tr>
              ))}
              {p.visible.length === 0 && (
                <tr>
                  <td colSpan={cols} style={{ textAlign: "center", color: "var(--text-2)" }} data-testid="conv-empty">
                    {rows.length === 0 ? (
                      L.empty
                    ) : withPacks.length === 0 && !needle && !showBaseOnly ? (
                      <span style={{ display: "grid", gap: 10, justifyItems: "center", padding: "8px 0" }}>
                        <span>
                          <b style={{ color: "var(--text-1)" }}>{L.emptyTitle}</b> {L.emptyHint}
                        </span>
                        <Link href="/products" className="sp-btn sp-btn--secondary sp-btn--sm" data-testid="open-products">
                          {L.openProducts}
                        </Link>
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
    </>
  );
}
