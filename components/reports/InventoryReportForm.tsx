"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import { isRealIsoDate, type FilterOption } from "@/lib/inventory-report-core";

// Parameter form of the three Inventory Reports. It only builds the report URL (View Report opens the
// separate print-friendly report route); the report route validates everything again on the server.
type Kind = "balance" | "movement" | "low";
type Initial = { warehouse?: string; category?: string; brand?: string; product?: string; zero?: boolean; from?: string; to?: string };

const ROUTE: Record<Kind, string> = { balance: "/reports/stock-balance", movement: "/reports/product-movement", low: "/reports/low-stock" };

export default function InventoryReportForm({
  kind,
  options,
  initial = {},
}: {
  kind: Kind;
  options: { warehouses: FilterOption[]; categories: FilterOption[]; brands: FilterOption[]; products: FilterOption[] };
  initial?: Initial;
}) {
  const T = useT();
  const C = T.invReports.common;
  const router = useRouter();
  const [f, setF] = useState({ warehouse: initial.warehouse ?? "", category: initial.category ?? "", brand: initial.brand ?? "", product: initial.product ?? "", zero: !!initial.zero, from: initial.from ?? "", to: initial.to ?? "" });
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: ev.target.type === "checkbox" ? (ev.target as HTMLInputElement).checked : ev.target.value });

  const title = kind === "balance" ? T.invReports.balance.title : kind === "movement" ? T.invReports.movement.title : T.invReports.low.title;
  const intro = kind === "balance" ? T.invReports.balance.intro : kind === "movement" ? T.invReports.movement.intro : T.invReports.low.intro;

  // Nothing to report on yet: say so instead of showing an unusable form.
  const missing = kind === "movement" ? (options.products.length === 0 ? "product" : null) : options.warehouses.length === 0 ? "warehouse" : null;

  function view() {
    if (kind === "balance" && !f.warehouse) return setErr(C.errWarehouse);
    if (kind === "movement") {
      if (!f.product) return setErr(C.errProduct);
      if ((f.from && !isRealIsoDate(f.from)) || (f.to && !isRealIsoDate(f.to))) return setErr(C.errDate);
      if (f.from && f.to && f.from > f.to) return setErr(C.errDateOrder);
    }
    setErr("");
    const sp = new URLSearchParams();
    if (kind === "movement") {
      sp.set("product", f.product);
      if (f.warehouse) sp.set("warehouse", f.warehouse);
      if (f.from) sp.set("from", f.from);
      if (f.to) sp.set("to", f.to);
    } else {
      if (f.warehouse) sp.set("warehouse", f.warehouse);
      if (f.category) sp.set("category", f.category);
      if (f.brand) sp.set("brand", f.brand);
      if (kind === "balance" && f.zero) sp.set("zero", "1");
    }
    router.push(`${ROUTE[kind]}?${sp.toString()}`);
  }

  const select = (id: string, label: string, value: string, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void, opts: FilterOption[], blank: string, required = false) => (
    <div className="sp-field">
      <label className="sp-label" htmlFor={id}>
        {label}
        {required && <i>*</i>}
      </label>
      <select id={id} className="sp-select " value={value} onChange={onChange}>
        <option value="">{blank}</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {title}
        </h1>
        <div />
      </div>
      <p className="t-caption" style={{ margin: "0 0 16px" }}>
        {intro} {C.readOnly}
      </p>

      {missing ? (
        <div className="sp-card sp-empty" data-testid="ir-setup">
          <Icon name="inbox" size={36} />
          <span>{missing === "product" ? C.noProducts : C.noWarehouses}</span>
          <Link href={missing === "product" ? "/products/create" : "/warehouse/create"} className="sp-btn sp-btn--secondary">
            {missing === "product" ? C.addProduct : C.addWarehouse}
          </Link>
        </div>
      ) : (
        <form
          className="sp-card"
          style={{ padding: 24 }}
          noValidate
          data-testid="ir-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            view();
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 24, alignItems: "start" }}>
            {kind === "movement" && select("ir-product", C.product, f.product, set("product"), options.products, C.chooseProduct, true)}
            {kind === "balance" && select("ir-warehouse", C.warehouse, f.warehouse, set("warehouse"), options.warehouses, C.chooseWarehouse, true)}
            {kind !== "balance" && select("ir-warehouse", C.warehouse, f.warehouse, set("warehouse"), options.warehouses, C.allWarehouses)}
            {kind !== "movement" && select("ir-category", C.category, f.category, set("category"), options.categories, C.allCategories)}
            {kind !== "movement" && select("ir-brand", C.brand, f.brand, set("brand"), options.brands, C.allBrands)}
            {kind === "movement" && (
              <>
                <div className="sp-field">
                  <label className="sp-label" htmlFor="ir-from">
                    {C.from}
                  </label>
                  <input id="ir-from" type="date" className="sp-input " value={f.from} onChange={set("from")} dir="ltr" />
                </div>
                <div className="sp-field">
                  <label className="sp-label" htmlFor="ir-to">
                    {C.to}
                  </label>
                  <input id="ir-to" type="date" className="sp-input " value={f.to} onChange={set("to")} dir="ltr" />
                </div>
              </>
            )}
            {kind === "balance" && (
              <div className="sp-field">
                <label className="sp-check" style={{ marginTop: 28 }}>
                  <input id="ir-zero" type="checkbox" checked={f.zero} onChange={set("zero")} />
                  {T.invReports.balance.includeZero}
                </label>
                <span className="sp-hint">{T.invReports.balance.includeZeroHint}</span>
              </div>
            )}
          </div>
          {kind === "movement" && (
            <p className="sp-hint" style={{ margin: "12px 0 0" }}>
              {T.invReports.movement.warehouseHint} {T.invReports.movement.dateHint}
            </p>
          )}
          {err && (
            <div className="sp-error" style={{ marginTop: 12 }} data-testid="ir-error" role="alert">
              {err}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}>
            <button type="submit" className="sp-btn sp-btn--primary" data-testid="ir-view">
              <Icon name="chart-column" size={18} />
              {C.viewReport}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
