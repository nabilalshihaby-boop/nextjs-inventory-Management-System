"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import { formatMoney, formatQuantity } from "@/lib/money";
import { saveCostBaseline, undoCostBaseline } from "@/app/(dashboard)/profit-loss/setup/actions";

// Owner-only Opening Inventory Cost Setup form. The browser sends only the currency id and a cost per Base Unit for each product
// the Owner filled in; quantities, totals, the cutover moment and the user are decided by the server. The totals shown here are
// a preview only (the same exact integer maths as the server).
type Cur = { id: string; label: string; code: string; symbol: string };
type Row = { productId: string; code: string; name: string; unit: string; onHand: string; uncosted: string };
type Existing = { id: string; code: string; name: string; currency: string; quantity: string; unitCost: string; total: string; effective: string; by: string; locked: boolean };

const COST_RE = /^\d{1,12}(\.\d{1,2})?$/;
const cents = (qty: string, cost: string) => {
  const [qi, qf = ""] = qty.split(".");
  const [ci, cf = ""] = cost.split(".");
  const q = BigInt(qi) * BigInt(1000) + BigInt((qf + "000").slice(0, 3));
  const c = BigInt(ci) * BigInt(100) + BigInt((cf + "00").slice(0, 2));
  return (q * c + BigInt(500)) / BigInt(1000);
};
const fromCents = (v: bigint) => `${v / BigInt(100)}.${String(v % BigInt(100)).padStart(2, "0")}`;

export default function CostSetupForm({ currencies, currencyId, iconRight, rows, existing }: { currencies: Cur[]; currencyId: string; iconRight: boolean; rows: Row[]; existing: Existing[] }) {
  const T = useT();
  const S = T.costSetup;
  const router = useRouter();
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [ack, setAck] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const cur = currencies.find((c) => c.id === currencyId) ?? null;
  const money = (v: string) => formatMoney(v, cur ? { code: cur.code, symbol: cur.symbol, right: iconRight } : null);

  const filled = rows.filter((r) => (costs[r.productId] ?? "").trim() !== "");
  const bad = filled.some((r) => !COST_RE.test(costs[r.productId].trim()));
  const total = filled.reduce((n, r) => (COST_RE.test(costs[r.productId].trim()) ? n + cents(r.uncosted, costs[r.productId].trim()) : n), BigInt(0));

  function save() {
    if (filled.length === 0) return setMsg({ ok: false, text: S.err.nothing });
    if (bad) return setMsg({ ok: false, text: S.err.invalid });
    setMsg(null);
    start(async () => {
      const r = await saveCostBaseline({ currencyId, items: filled.map((x) => ({ productId: x.productId, unitCost: costs[x.productId].trim() })) });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        setCosts({});
        setAck(false);
        router.refresh();
      }
    });
  }
  function undo(id: string) {
    if (!window.confirm(S.undoConfirm)) return;
    start(async () => {
      const r = await undoCostBaseline(id);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  }

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {S.title}
        </h1>
        <Link href="/profit-loss" className="sp-btn sp-btn--secondary">
          <Icon name="arrow-left" size={18} />
          {S.backToPl}
        </Link>
      </div>
      <p className="t-caption" style={{ margin: "0 0 16px" }}>
        {S.intro}
      </p>

      <section className="sp-card" style={{ padding: 20, marginBottom: 16 }} data-testid="cs-explain">
        <div className="t-section-title" style={{ marginBottom: 8 }}>
          {S.notStockTitle}
        </div>
        <ul style={{ margin: 0, paddingInlineStart: 20, display: "grid", gap: 4 }}>
          {[S.b1, S.b2, S.b3, S.b4, S.b5].map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>

      {msg && (
        <div className={msg.ok ? "sp-card" : "sp-error"} role={msg.ok ? "status" : "alert"} data-testid={msg.ok ? "cs-ok" : "cs-error"} style={{ padding: "12px 16px", marginBottom: 16 }}>
          {msg.text}
        </div>
      )}

      {currencies.length === 0 ? (
        <div className="sp-card sp-empty" data-testid="cs-nocurrency">
          <Icon name="inbox" size={36} />
          <span>{S.noCurrency}</span>
        </div>
      ) : (
        <section className="sp-card" style={{ padding: 24, marginBottom: 24 }} data-testid="cs-form">
          <div className="sp-field" style={{ maxWidth: 420, marginBottom: 16 }}>
            <label className="sp-label" htmlFor="cs-currency">
              {S.currency}
            </label>
            {currencies.length > 1 ? (
              <select id="cs-currency" className="sp-select " value={currencyId} onChange={(e) => router.push(e.target.value ? `/profit-loss/setup?currency=${encodeURIComponent(e.target.value)}` : "/profit-loss/setup")}>
                <option value="">{S.chooseCurrency}</option>
                {currencies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            ) : (
              <div className="sp-input" style={{ display: "flex", alignItems: "center" }} data-testid="cs-currency-fixed">
                <bdi dir="ltr">{currencies[0].label}</bdi>
              </div>
            )}
            {currencies.length > 1 && <span className="sp-hint">{S.currencyHint}</span>}
          </div>

          {!cur ? null : rows.length === 0 ? (
            <div className="sp-empty" data-testid="cs-empty">
              <span>{S.empty}</span>
            </div>
          ) : (
            <>
              <p className="sp-hint" style={{ margin: "0 0 12px" }}>
                {S.costHint}
              </p>
              <div style={{ overflowX: "auto" }}>
                <table className="sp-table" data-testid="cs-table" style={{ width: "100%", minWidth: 720 }}>
                  <thead>
                    <tr>
                      <th>{S.cols.code}</th>
                      <th>{S.cols.name}</th>
                      <th>{S.cols.unit}</th>
                      <th>{S.cols.onHand}</th>
                      <th>{S.cols.uncosted}</th>
                      <th>{S.cols.cost}</th>
                      <th>{S.cols.total}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const v = (costs[r.productId] ?? "").trim();
                      return (
                        <tr key={r.productId} data-testid="cs-row" data-product={r.productId}>
                          <td>
                            <bdi dir="ltr">{r.code}</bdi>
                          </td>
                          <td>{r.name}</td>
                          <td>{r.unit}</td>
                          <td>
                            <bdi dir="ltr">{formatQuantity(r.onHand)}</bdi>
                          </td>
                          <td>
                            <bdi dir="ltr">{formatQuantity(r.uncosted)}</bdi>
                          </td>
                          <td style={{ minWidth: 150 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <input className="sp-input " inputMode="decimal" dir="ltr" aria-label={`${S.cols.cost} ${r.code}`} value={costs[r.productId] ?? ""} onChange={(e) => setCosts({ ...costs, [r.productId]: e.target.value })} data-testid="cs-cost" />
                              <bdi dir="ltr" className="sp-hint">
                                {cur.code}
                              </bdi>
                            </div>
                            {v !== "" && !COST_RE.test(v) && <span className="sp-error">{S.err.invalid}</span>}
                          </td>
                          <td>
                            <bdi dir="ltr">{v !== "" && COST_RE.test(v) ? money(fromCents(cents(r.uncosted, v))) : "—"}</bdi>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginTop: 16 }}>
                <label className="sp-check">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="cs-ack" />
                  {S.confirm}
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <span>
                    {S.totalAll}: <b data-testid="cs-total"><bdi dir="ltr">{money(fromCents(total))}</bdi></b>
                  </span>
                  <button type="button" className="sp-btn sp-btn--primary" disabled={!ack || pending || filled.length === 0} onClick={save} data-testid="cs-save">
                    {pending ? S.saving : S.save}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {existing.length > 0 && (
        <section className="sp-card" style={{ padding: 24 }} data-testid="cs-existing">
          <div className="t-section-title" style={{ marginBottom: 4 }}>
            {S.existingTitle}
          </div>
          <p className="sp-hint" style={{ margin: "0 0 12px" }}>
            {S.effectiveNote}
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="sp-table cs-fit" style={{ width: "100%", minWidth: 720 }}>
              <thead>
                <tr>
                  <th>{S.cols.code}</th>
                  <th>{S.cols.name}</th>
                  <th>{S.existingCols.quantity}</th>
                  <th>{S.existingCols.cost}</th>
                  <th>{S.existingCols.total}</th>
                  <th>{S.existingCols.effective} / {S.existingCols.by}</th>
                  <th>{S.existingCols.status}</th>
                </tr>
              </thead>
              <tbody>
                {existing.map((b) => (
                  <tr key={b.id} data-testid="cs-existing-row" data-locked={b.locked ? "1" : "0"}>
                    <td>
                      <bdi dir="ltr">{b.code}</bdi>
                    </td>
                    <td>{b.name}</td>
                    <td>
                      <bdi dir="ltr">{formatQuantity(b.quantity)}</bdi>
                    </td>
                    <td>
                      <bdi dir="ltr">{`${b.currency} ${b.unitCost}`}</bdi>
                    </td>
                    <td>
                      <bdi dir="ltr">{`${b.currency} ${b.total}`}</bdi>
                    </td>
                    <td>
                      <bdi dir="ltr">{b.effective}</bdi>
                      <div className="sp-hint">{b.by}</div>
                    </td>
                    <td>
                      {b.locked ? (
                        <span data-testid="cs-locked" style={{ display: "inline-block", minWidth: 150 }}>{S.locked}</span>
                      ) : (
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <span>{S.active}</span>
                          <button type="button" className="sp-btn sp-btn--secondary" disabled={pending} onClick={() => undo(b.id)} data-testid="cs-undo">
                            {S.undo}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
