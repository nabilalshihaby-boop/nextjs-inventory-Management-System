"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import { isRealIsoDate } from "@/lib/inventory-report-core";

// Parameter form of the Cash Flow report. It only builds the report URL (View Report opens the separate, print-friendly report
// route); the route validates everything again on the server. A currency is chosen here only when more than one currency has
// Cash & Bank activity — amounts of different currencies are never combined.
export type CfCurrencyOption = { id: string; label: string };

export default function CashFlowForm({ currencies, initial }: { currencies: CfCurrencyOption[]; initial: { from: string; to: string; currency: string } }) {
  const T = useT();
  const C = T.cashFlow;
  const router = useRouter();
  const multi = currencies.length > 1;
  const [f, setF] = useState({ from: initial.from, to: initial.to, currency: currencies.some((c) => c.id === initial.currency) ? initial.currency : "" });
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: ev.target.value });

  function view() {
    if (!f.from) return setErr(C.err.errFrom);
    if (!f.to) return setErr(C.err.errTo);
    if (!isRealIsoDate(f.from) || !isRealIsoDate(f.to)) return setErr(C.err.errDate);
    if (f.from > f.to) return setErr(C.err.errDateOrder);
    if (multi && !f.currency) return setErr(C.err.errCurrencyRequired);
    setErr("");
    const sp = new URLSearchParams({ from: f.from, to: f.to });
    if (multi) sp.set("currency", f.currency);
    router.push(`/reports/cash-flow?${sp.toString()}`);
  }

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {C.title}
        </h1>
        <div />
      </div>
      <p className="t-caption" style={{ margin: "0 0 16px" }}>
        {C.intro} {C.readOnly}
      </p>

      {currencies.length === 0 ? (
        <div className="sp-card sp-empty" data-testid="cf-setup">
          <Icon name="inbox" size={36} />
          <span>{C.noCurrency}</span>
          <Link href="/finance/accounts" className="sp-btn sp-btn--secondary">
            {C.addAccount}
          </Link>
        </div>
      ) : (
        <form
          className="sp-card"
          style={{ padding: 24 }}
          noValidate
          data-testid="cf-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            view();
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 24, alignItems: "start" }}>
            <div className="sp-field">
              <label className="sp-label" htmlFor="cf-from">
                {C.from}
                <i>*</i>
              </label>
              <input id="cf-from" type="date" className="sp-input " value={f.from} onChange={set("from")} dir="ltr" required />
            </div>
            <div className="sp-field">
              <label className="sp-label" htmlFor="cf-to">
                {C.to}
                <i>*</i>
              </label>
              <input id="cf-to" type="date" className="sp-input " value={f.to} onChange={set("to")} dir="ltr" required />
            </div>
            <div className="sp-field">
              <label className="sp-label" htmlFor="cf-currency">
                {C.currency}
                {multi && <i>*</i>}
              </label>
              {multi ? (
                <select id="cf-currency" className="sp-select " value={f.currency} onChange={set("currency")}>
                  <option value="">{C.chooseCurrency}</option>
                  {currencies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="sp-input" data-testid="cf-currency-fixed" style={{ display: "flex", alignItems: "center" }}>
                  <bdi dir="ltr">{currencies[0].label}</bdi>
                </div>
              )}
              <span className="sp-hint">{multi ? C.currencyHint : C.currencyOnly}</span>
            </div>
          </div>
          {err && (
            <div className="sp-error" style={{ marginTop: 12 }} data-testid="cf-error" role="alert">
              {err}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}>
            <button type="submit" className="sp-btn sp-btn--primary" data-testid="cf-view">
              <Icon name="chart-column" size={18} />
              {C.viewReport}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
