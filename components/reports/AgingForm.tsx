"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import { isRealIsoDate } from "@/lib/inventory-report-core";

// Parameter form of the Receivables & Payables Aging report. It only builds the report URL (View Report opens the separate,
// print-friendly report route); the route validates every parameter again on the server. A currency is chosen here only when more
// than one currency is in use — amounts of different currencies are never combined.
type Opt = { id: string; label: string };
type Type = "receivables" | "payables" | "both";

export default function AgingForm({
  currencies,
  customers,
  suppliers,
  initial,
  today,
}: {
  currencies: Opt[];
  customers: Opt[];
  suppliers: Opt[];
  initial: { type: string; asOf: string; currency: string; customer: string; supplier: string };
  today: string;
}) {
  const T = useT();
  const A = T.aging;
  const router = useRouter();
  const multi = currencies.length > 1;
  const [f, setF] = useState({
    type: (["receivables", "payables", "both"].includes(initial.type) ? initial.type : "both") as Type,
    asOf: initial.asOf,
    currency: currencies.some((c) => c.id === initial.currency) ? initial.currency : "",
    customer: initial.customer,
    supplier: initial.supplier,
  });
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: ev.target.value });

  function view() {
    if (!f.asOf) return setErr(A.err.errAsOfRequired);
    if (!isRealIsoDate(f.asOf)) return setErr(A.err.errAsOfInvalid);
    if (f.asOf > today) return setErr(A.err.errAsOfFuture);
    if (multi && !f.currency) return setErr(A.err.errCurrencyRequired);
    setErr("");
    const sp = new URLSearchParams({ type: f.type, asOf: f.asOf });
    if (f.currency) sp.set("currency", f.currency);
    if (f.type !== "payables" && f.customer) sp.set("customer", f.customer);
    if (f.type !== "receivables" && f.supplier) sp.set("supplier", f.supplier);
    router.push(`/reports/receivables-payables-aging?${sp.toString()}`);
  }

  const select = (id: string, label: string, value: string, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void, opts: Opt[], blank: string, required = false) => (
    <div className="sp-field">
      <label className="sp-label" htmlFor={id}>
        {label}
        {required && <i>*</i>}
      </label>
      <select id={id} className="sp-select " value={value} onChange={onChange}>
        <option value="">{blank}</option>
        {opts.map((o) => (
          <option key={o.id} value={o.id}>
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
          {A.title}
        </h1>
        <div />
      </div>
      <p className="t-caption" style={{ margin: "0 0 16px" }}>
        {A.intro} {A.readOnly}
      </p>

      {currencies.length === 0 ? (
        <div className="sp-card sp-empty" data-testid="ag-setup">
          <Icon name="inbox" size={36} />
          <span>{A.noData}</span>
          <Link href="/sales" className="sp-btn sp-btn--secondary">
            {T.nav.sales ?? "Sales"}
          </Link>
        </div>
      ) : (
        <form
          className="sp-card"
          style={{ padding: 24 }}
          noValidate
          data-testid="ag-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            view();
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 24, alignItems: "start" }}>
            <div className="sp-field">
              <label className="sp-label" htmlFor="ag-type">
                {A.reportType}
                <i>*</i>
              </label>
              <select id="ag-type" className="sp-select " value={f.type} onChange={set("type")}>
                {(["receivables", "payables", "both"] as const).map((k) => (
                  <option key={k} value={k}>
                    {A.types[k]}
                  </option>
                ))}
              </select>
              <span className="sp-hint">{A.typeHint}</span>
            </div>
            <div className="sp-field">
              <label className="sp-label" htmlFor="ag-asof">
                {A.asOf}
                <i>*</i>
              </label>
              <input id="ag-asof" type="date" className="sp-input " value={f.asOf} max={today} onChange={set("asOf")} dir="ltr" required />
              <span className="sp-hint">{A.asOfHint}</span>
            </div>
            <div className="sp-field">
              <label className="sp-label" htmlFor="ag-currency">
                {A.currency}
                {multi && <i>*</i>}
              </label>
              {multi ? (
                <select id="ag-currency" className="sp-select " value={f.currency} onChange={set("currency")}>
                  <option value="">{A.chooseCurrency}</option>
                  {currencies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="sp-input" data-testid="ag-currency-fixed" style={{ display: "flex", alignItems: "center" }}>
                  <bdi dir="ltr">{currencies[0].label}</bdi>
                </div>
              )}
              <span className="sp-hint">{multi ? A.currencyHint : A.currencyOnly}</span>
            </div>
            {f.type !== "payables" && select("ag-customer", A.customer, f.customer, set("customer"), customers, A.allCustomers)}
            {f.type !== "receivables" && select("ag-supplier", A.supplier, f.supplier, set("supplier"), suppliers, A.allSuppliers)}
          </div>
          {err && (
            <div className="sp-error" style={{ marginTop: 12 }} data-testid="ag-error" role="alert">
              {err}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}>
            <button type="submit" className="sp-btn sp-btn--primary" data-testid="ag-view">
              <Icon name="chart-column" size={18} />
              {A.viewReport}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
