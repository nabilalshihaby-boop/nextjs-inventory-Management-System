"use client";

import Link from "next/link";
import { useState } from "react";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import Pagination, { paginate } from "@/components/ui/Pagination";
import RowMenu from "@/components/ui/RowMenu";
import type { ProductRow } from "@/lib/products";

// Port of design/Products.html: TableToolbar (Filter / Export / Import / Create Product),
// DataTable (Product image / Name / Code / Brand / Price / Product Unit / In Stock / Created On)
// and Pagination, plus a row menu (Edit only) for OWNER/ADMIN. Search/paging run over the
// server-loaded list. Filter, Export and Import are deferred ("Coming soon").
const SOON = {
  filter: "Product filters are coming soon.",
  export: "Export Products is coming soon.",
  import: "Import Products is coming soon.",
};

export default function ProductsTable({ rows, canManage }: { rows: ProductRow[]; canManage: boolean }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const needle = q.trim().toLowerCase();
  const filtered = needle ? rows.filter((r) => [r.name, r.code, r.brand, r.unit].join(" ").toLowerCase().includes(needle)) : rows;
  const p = paginate(filtered, page, pageSize);
  const soon = (m: string) => toast(m, { id: "products-soon", icon: "ℹ️" });
  const disabled = { opacity: 0.5, cursor: "not-allowed" } as const;
  const cols = canManage ? 9 : 8;

  return (
    <>
      <div className="sp-toolbar">
        <div className="sp-group">
          <Icon name="search" size={18} className="sp-input-icon" />
          <input
            className="sp-input "
            placeholder="Search"
            aria-label="Search products"
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
            {/* aria-disabled (not disabled) keeps them focusable so the explanation can be read/shown. */}
            <button type="button" className="sp-btn sp-btn--secondary sp-btn--icon" aria-label="Filter (coming soon)" aria-disabled="true" title={SOON.filter} style={disabled} onClick={() => soon(SOON.filter)}>
              <Icon name="filter" size={18} />
            </button>
            <button type="button" className="sp-btn sp-btn--secondary" aria-disabled="true" title={SOON.export} style={disabled} onClick={() => soon(SOON.export)}>
              <Icon name="upload" size={18} />
              Export Products
            </button>
            <button type="button" className="sp-btn sp-btn--secondary" aria-disabled="true" title={SOON.import} style={disabled} onClick={() => soon(SOON.import)}>
              <Icon name="download" size={18} />
              Import Products
            </button>
            <Link href="/products/create" className="sp-btn sp-btn--primary">
              <Icon name="plus" size={18} />
              Create Product
            </Link>
          </>
        )}
      </div>

      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Name</th>
                <th>Code</th>
                <th>Brand</th>
                <th>Price</th>
                <th>Product Unit</th>
                <th>In Stock</th>
                <th>Created On</th>
                {canManage && <th className="act">Action</th>}
              </tr>
            </thead>
            <tbody>
              {p.visible.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.image ? (
                      // eslint-disable-next-line @next/next/no-img-element -- runtime upload under /uploads
                      <img src={r.image} alt="" className="sp-thumb" style={{ objectFit: "cover" }} />
                    ) : (
                      <span className="sp-thumb" />
                    )}
                  </td>
                  <td className="primary-cell">{r.name}</td>
                  <td>
                    <span className="sp-code">{r.code}</span>
                  </td>
                  <td>{r.brand}</td>
                  <td>{r.price}</td>
                  <td>
                    <span className="sp-badge sp-badge--neutral">{r.unit}</span>
                  </td>
                  <td>
                    <b style={{ fontWeight: 600, color: r.lowStock ? "var(--danger-700)" : undefined }} title={r.lowStock ? "At or below the stock alert" : undefined}>
                      {r.inStock}
                    </b>
                  </td>
                  <td>
                    <span className="sp-badge sp-badge--info">{r.createdOn}</span>
                  </td>
                  {canManage && (
                    <td className="act">
                      <RowMenu label={r.name} items={[{ label: "Edit", icon: "pencil", href: `/products/${encodeURIComponent(r.id)}/edit` }]} />
                    </td>
                  )}
                </tr>
              ))}
              {p.visible.length === 0 && (
                <tr>
                  <td colSpan={cols} style={{ textAlign: "center", color: "var(--text-2)" }}>
                    {rows.length === 0 ? (
                      <span>
                        <b style={{ color: "var(--text-1)" }}>No products yet</b>
                        {canManage ? " — use Create Product to add your first product." : "."}
                      </span>
                    ) : (
                      "No products match your search."
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
