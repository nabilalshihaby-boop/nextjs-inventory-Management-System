"use client";

import Link from "next/link";
import { useState } from "react";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import Pagination, { paginate } from "@/components/ui/Pagination";
import { fmt } from "@/lib/i18n/config";

export type ProductUnitConversionRow = { id: string; code: string; name: string; base: string; packs: { unit: string; factor: string; active: boolean }[] };

// Product Unit Conversions overview: product → base unit + pack units. Search/paging run over the server-loaded list.
export default function ProductUnitConversionsTable({ rows, canManage }: { rows: ProductUnitConversionRow[]; canManage: boolean }) {
  const T = useT();
  const L = T.units.page;
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const needle = q.trim().toLowerCase();
  const filtered = needle ? rows.filter((r) => [r.code, r.name, r.base, ...r.packs.map((x) => x.unit)].join(" ").toLowerCase().includes(needle)) : rows;
  const p = paginate(filtered, page, pageSize);

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
      </div>
      <p className="t-caption" style={{ margin: "0 0 12px" }}>
        {L.intro}
      </p>
      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table" data-testid="base-units">
            <thead>
              <tr>
                <th>{L.colProduct}</th>
                <th>{L.colBase}</th>
                <th>{L.colUnits}</th>
                {canManage && <th className="act">{L.colAction}</th>}
              </tr>
            </thead>
            <tbody>
              {p.visible.map((r) => (
                <tr key={r.id} data-code={r.code}>
                  <td>
                    <span className="sp-code">
                      <bdi dir="ltr">{r.code}</bdi>
                    </span>{" "}
                    <span className="primary-cell">{r.name}</span>
                  </td>
                  <td>
                    <span className="sp-badge sp-badge--info">{r.base}</span>
                  </td>
                  <td data-testid="packs">
                    {r.packs.length === 0 ? (
                      <span style={{ color: "var(--text-3)" }}>{L.none}</span>
                    ) : (
                      <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {r.packs.map((x) => (
                          <span key={x.unit} className={"sp-badge " + (x.active ? "sp-badge--success" : "sp-badge--neutral")}>
                            <bdi dir="ltr">{fmt(L.chip, { unit: x.unit, factor: x.factor })}</bdi>
                            {!x.active && <> · {L.inactive}</>}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  {canManage && (
                    <td className="act">
                      <Link href={`/products/${encodeURIComponent(r.id)}/edit`} className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={fmt(L.editAria, { name: r.name })} style={{ color: "var(--primary-600)" }}>
                        <Icon name="pencil" size={16} />
                      </Link>
                    </td>
                  )}
                </tr>
              ))}
              {p.visible.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 4 : 3} style={{ textAlign: "center", color: "var(--text-2)" }}>
                    {rows.length === 0 ? L.empty : L.noMatch}
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
