"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import { isRealIsoDate } from "@/lib/inventory-report-core";

// Parameter form of Profit & Loss. It only builds the report URL (View Report opens the separate, print-friendly
// report route); the report route validates everything again on the server. A currency is chosen here only when
// more than one currency is in use — amounts of different currencies are never combined.
export type PlCurrencyOption = { id: string; label: string };

export default function ProfitLossForm({ currencies, initial, canSetup = false }: { currencies: PlCurrencyOption[]; initial: { from: string; to: string; currency: string }; canSetup?: boolean }) {
  const T = useT();
  const P = T.profitLoss;
  const router = useRouter();
  const multi = currencies.length > 1;
  const [f, setF] = useState({ from: initial.from, to: initial.to, currency: currencies.some((c) => c.id === initial.currency) ? initial.currency : "" });
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: ev.target.value });

  function view() {
    if (!f.from) return setErr(P.err.errFrom);
    if (!f.to) return setErr(P.err.errTo);
    if (!isRealIsoDate(f.from) || !isRealIsoDate(f.to)) return setErr(P.err.errDate);
    if (f.from > f.to) return setErr(P.err.errDateOrder);
    if (multi && !f.currency) return setErr(P.err.errCurrencyRequired);
    setErr("");
    const sp = new URLSearchParams({ from: f.from, to: f.to });
    if (multi) sp.set("currency", f.currency);
    router.push(`/reports/profit-loss?${sp.toString()}`);
  }

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {P.title}
        </h1>
        {canSetup ? (
          <Link href="/profit-loss/setup" className="sp-btn sp-btn--secondary" data-testid="pl-setup-open">
            {P.setupLink}
          </Link>
        ) : (
          <div />
        )}
      </div>
      <p className="t-caption" style={{ margin: "0 0 16px" }}>
        {P.intro} {P.readOnly}
      </p>

      {currencies.length === 0 ? (
        <div className="sp-card sp-empty" data-testid="pl-setup">
          <Icon name="inbox" size={36} />
          <span>{P.noCurrency}</span>
          <Link href="/currencies" className="sp-btn sp-btn--secondary">
            {P.addCurrency}
          </Link>
        </div>
      ) : (
        <form
          className="sp-card"
          style={{ padding: 24 }}
          noValidate
          data-testid="pl-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            view();
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 24, alignItems: "start" }}>
            <div className="sp-field">
              <label className="sp-label" htmlFor="pl-from">
                {P.from}
                <i>*</i>
              </label>
              <input id="pl-from" type="date" className="sp-input " value={f.from} onChange={set("from")} dir="ltr" required />
            </div>
            <div className="sp-field">
              <label className="sp-label" htmlFor="pl-to">
                {P.to}
                <i>*</i>
              </label>
              <input id="pl-to" type="date" className="sp-input " value={f.to} onChange={set("to")} dir="ltr" required />
            </div>
            <div className="sp-field">
              <label className="sp-label" htmlFor="pl-currency">
                {P.currency}
                {multi && <i>*</i>}
              </label>
              {multi ? (
                <select id="pl-currency" className="sp-select " value={f.currency} onChange={set("currency")}>
                  <option value="">{P.chooseCurrency}</option>
                  {currencies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="sp-input" data-testid="pl-currency-fixed" style={{ display: "flex", alignItems: "center" }}>
                  <bdi dir="ltr">{currencies[0].label}</bdi>
                </div>
              )}
              <span className="sp-hint">{multi ? P.currencyHint : P.currencyOnly}</span>
            </div>
          </div>
          {err && (
            <div className="sp-error" style={{ marginTop: 12 }} data-testid="pl-error" role="alert">
              {err}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}>
            <button type="submit" className="sp-btn sp-btn--primary" data-testid="pl-view">
              <Icon name="chart-column" size={18} />
              {P.viewReport}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
