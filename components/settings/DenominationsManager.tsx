"use client";

import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { createDenomination, deleteDenomination, updateDenomination } from "@/app/(dashboard)/settings/denominations/actions";
import Icon from "@/components/layout/Icon";
import Modal from "@/components/ui/Modal";
import type { DenominationRow } from "@/lib/denominations";

// Cash denominations per currency (Owner): add, edit label/value, inactivate/activate, delete (only while
// unused). Nothing is pre-filled. A denomination used by a closed register count keeps its value
// (frozen), and cannot be deleted - inactivate it instead. Every change is validated again on the server.
export default function DenominationsManager({ rows, currencies }: { rows: DenominationRow[]; currencies: { value: string; label: string }[] }) {
    const router = useRouter();
  const T = useT();
  const D = T.denom;
  const [pending, startTransition] = useTransition();
  const [currencyId, setCurrencyId] = useState(currencies.length === 1 ? currencies[0].value : "");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState<DenominationRow | null>(null);
  const [eValue, setEValue] = useState("");
  const [eLabel, setELabel] = useState("");
  const [eErr, setEErr] = useState("");

  function run(fn: () => Promise<{ ok: boolean; message: string }>, after?: () => void) {
    startTransition(async () => {
      try {
        const r = await fn();
        if (!r.ok) return void toast.error(r.message, { id: "denom" });
        toast.success(r.message, { id: "denom" });
        after?.();
        router.refresh();
      } catch {
        toast.error(T.common.somethingWrong, { id: "denom" });
      }
    });
  }
  function add() {
    if (!currencyId) return setErr(D.val.chooseCurrency);
    setErr("");
    startTransition(async () => {
      try {
        const r = await createDenomination({ currencyId, value: value.trim(), label });
        if (!r.ok) {
          setErr(r.message);
          return void toast.error(r.message, { id: "denom" });
        }
        toast.success(r.message, { id: "denom" });
        setValue("");
        setLabel("");
        router.refresh();
      } catch {
        setErr(T.common.somethingWrong);
      }
    });
  }
  function saveEdit() {
    if (!edit) return;
    setEErr("");
    startTransition(async () => {
      try {
        const r = await updateDenomination(edit.id, { value: eValue.trim(), label: eLabel, active: edit.active });
        if (!r.ok) return void setEErr(r.message);
        toast.success(r.message, { id: "denom" });
        setEdit(null);
        router.refresh();
      } catch {
        setEErr(T.common.somethingWrong);
      }
    });
  }

  return (
    <>
      <div className="sp-card" style={{ padding: 24, marginBottom: 24 }}>
        <div className="t-section-title" style={{ marginBottom: 12 }}>{D.addTitle}</div>
        <p className="t-caption" style={{ margin: "0 0 12px" }}>
                    {D.intro}
</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr)) auto", gap: 16, alignItems: "end" }}>
          <div className="sp-field">
            <label className="sp-label" htmlFor="dn-currency">{D.currency}<i>*</i></label>
            <select id="dn-currency" className="sp-select" value={currencyId} onChange={(e) => setCurrencyId(e.target.value)}>
              <option value="">{D.selectCurrency}</option>
              {currencies.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sp-field">
            <label className="sp-label" htmlFor="dn-value">{D.value}<i>*</i></label>
            <input id="dn-value" className="sp-input" dir="ltr" inputMode="decimal" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <div className="sp-field">
            <label className="sp-label" htmlFor="dn-label">{D.label}</label>
            <input id="dn-label" className="sp-input" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <button type="button" className="sp-btn sp-btn--primary" data-testid="dn-add" disabled={pending} onClick={add}>
                        <Icon name="plus" size={18} />
            {D.add}
</button>
        </div>
        {currencies.length === 0 && (
          <p className="t-caption" style={{ marginTop: 8 }}>
                        {D.noCurrencies} <Link href="/currencies">{D.createCurrency}</Link> {D.createFirst}
</p>
        )}
        {err && (
          <div className="sp-error" role="alert" data-testid="dn-error" style={{ marginTop: 10 }}>
            {err}
          </div>
        )}
      </div>

      <div className="sp-table-card">
        <div className="sp-table-scroll">
          <table className="sp-table" data-testid="dn-table">
            <thead>
              <tr>
                <th>{D.colCurrency}</th>
                <th className="num">{D.colValue}</th>
                <th>{D.colLabel}</th>
                <th>{D.colStatus}</th>
                <th className="num">{D.colAction}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", color: "var(--text-2)" }}>
                                        {D.empty}
</td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} data-value={r.value} data-currency={r.currencyCode}>
                  <td>{r.currencyCode}</td>
                  <td className="num">{r.value}</td>
                  <td>{r.label || "—"}</td>
                  <td>
                    <span className={`sp-badge sp-badge--${r.active ? "success" : "neutral"}`}>{r.active ? D.active : D.inactive}</span>
                    {r.used && <span className="t-caption" style={{ display: "block" }}>{D.usedClosed}</span>}
                  </td>
                  <td className="num">
                    <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" data-testid="dn-edit" disabled={pending} onClick={() => { setEdit(r); setEValue(r.value); setELabel(r.label); setEErr(""); }}>
                                                <Icon name="pencil" size={16} />
                        {D.edit}
</button>
                      <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" data-testid="dn-toggle" disabled={pending} onClick={() => run(() => updateDenomination(r.id, { value: r.value, label: r.label, active: !r.active }))}>
                        {r.active ? D.inactivate : D.activate}
                      </button>
                      <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" data-testid="dn-delete" style={{ color: "var(--danger-500)" }} disabled={pending || r.used} title={r.used ? D.usedTitle : undefined} onClick={() => run(() => deleteDenomination(r.id))}>
                        <Icon name="trash-2" size={16} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {edit && (
        <Modal
          size="sm"
          title={fmt(D.editTitle, { currency: edit.currencyCode, value: edit.value })}
          onClose={() => setEdit(null)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setEdit(null)}>
                {D.cancel}
</button>
              <button type="button" className="sp-btn sp-btn--primary" data-testid="dn-save" disabled={pending} onClick={saveEdit}>
                {D.save}
</button>
            </>
          }
        >
          <div className="sp-field">
            <label className="sp-label" htmlFor="dn-evalue">{D.value}</label>
            <input id="dn-evalue" className="sp-input" inputMode="decimal" disabled={edit.used} value={eValue} onChange={(e) => setEValue(e.target.value)} />
            {edit.used && <span className="sp-hint">{D.frozenHint}</span>}
          </div>
          <div className="sp-field" style={{ marginTop: 12 }}>
            <label className="sp-label" htmlFor="dn-elabel">{D.label}</label>
            <input id="dn-elabel" className="sp-input" maxLength={60} value={eLabel} onChange={(e) => setELabel(e.target.value)} />
          </div>
          {eErr && (
            <div className="sp-error" role="alert" style={{ marginTop: 10 }}>
              {eErr}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
