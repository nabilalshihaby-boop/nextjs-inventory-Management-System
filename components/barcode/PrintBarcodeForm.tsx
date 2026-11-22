"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import type { SelProduct, SelUnit } from "@/lib/barcode-labels";
import { LABEL_SIZES, MAX_LABELS_PER_ITEM, MAX_LABELS_TOTAL, MAX_LABEL_ITEMS, PAPERS, PAPER_IDS, labelRequestQuery, sizesFor, type LabelSizeId, type PaperId } from "@/lib/barcode-labels-core";

// Print Barcode — selection screen (design/Print Barcode.html). It only collects a choice of product units and label
// counts and builds the URL of the separate label-preview route; it never prints and never writes anything. The
// preview route re-reads every unit, barcode and price on the server.
type Row = { conversionId: string; qty: string };
export type PrintInitial = { items: { conversionId: string; qty: number }[]; paper: PaperId | ""; size: LabelSizeId | ""; company: boolean; name: boolean; price: boolean };

export default function PrintBarcodeForm({ products, initial }: { products: SelProduct[]; initial: PrintInitial }) {
  const T = useT();
  const P = T.barcode.print;
  const router = useRouter();
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const [rows, setRows] = useState<Row[]>(initial.items.map((i) => ({ conversionId: i.conversionId, qty: String(i.qty) })));
  // Paper and layout are chosen explicitly (no silent default): the layout list only offers sheets made for the chosen paper.
  const [paper, setPaper] = useState<PaperId | "">(initial.paper);
  const [size, setSize] = useState<LabelSizeId | "">(initial.size);
  const [company, setCompany] = useState(initial.company);
  const [name, setName] = useState(initial.name);
  const [price, setPrice] = useState(initial.price);
  const [err, setErr] = useState("");

  const byUnit = useMemo(() => {
    const m = new Map<string, { p: SelProduct; u: SelUnit }>();
    for (const p of products) for (const u of p.units) m.set(u.conversionId, { p, u });
    return m;
  }, [products]);

  const needle = q.trim().toLowerCase();
  // One suggestion per ACTIVE unit; matching by code, name or any unit barcode.
  const suggestions = useMemo(() => {
    if (!needle) return [];
    const out: { p: SelProduct; u: SelUnit }[] = [];
    for (const p of products) {
      const productHit = `${p.code} ${p.name}`.toLowerCase().includes(needle);
      for (const u of p.units) {
        if (productHit || (u.barcode ?? "").toLowerCase().includes(needle)) out.push({ p, u });
        if (out.length >= 30) return out;
      }
    }
    return out;
  }, [needle, products]);

  const add = (id: string) => {
    if (rows.some((r) => r.conversionId === id)) return setQ("");
    setRows([...rows, { conversionId: id, qty: "1" }]);
    setQ("");
    setErr("");
  };
  const setQty = (id: string, qty: string) => setRows(rows.map((r) => (r.conversionId === id ? { ...r, qty } : r)));

  function view() {
    if (rows.length === 0) return setErr(P.errNone);
    if (rows.length > MAX_LABEL_ITEMS) return setErr(fmt(P.errItems, { max: MAX_LABEL_ITEMS }));
    let total = 0;
    const items: { conversionId: string; qty: number }[] = [];
    for (const r of rows) {
      const n = /^\d{1,4}$/.test(r.qty.trim()) ? Number(r.qty.trim()) : 0;
      const hit = byUnit.get(r.conversionId);
      if (n < 1 || n > MAX_LABELS_PER_ITEM) return setErr(fmt(P.errQty, { name: hit ? `${hit.p.code} (${hit.u.unitName})` : "", max: MAX_LABELS_PER_ITEM }));
      total += n;
      items.push({ conversionId: r.conversionId, qty: n });
    }
    if (total > MAX_LABELS_TOTAL) return setErr(fmt(P.errTotal, { max: MAX_LABELS_TOTAL }));
    // The paper and its layout are an explicit choice (no silent default); a layout must belong to the chosen paper.
    if (!paper) return setErr(P.errPaper);
    if (!size || LABEL_SIZES[size].paper !== paper) return setErr(P.errSize);
    setErr("");
    router.push(`/print-barcode/labels?${labelRequestQuery({ items, paper, size, company, name, price })}`);
  }
  function reset() {
    setRows([]);
    setQ("");
    setErr("");
  }

  if (products.length === 0) {
    return (
      <div className="sp-card sp-empty" data-testid="print-empty">
        <b>{P.emptyTitle}</b>
        <span>{P.emptyBody}</span>
        <Link href="/products" className="sp-btn sp-btn--primary">
          {P.emptyLink}
        </Link>
      </div>
    );
  }

  return (
    <div className="sp-card sp-form-card" data-testid="print-barcode">
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <p className="t-caption" style={{ margin: 0 }}>
          {P.intro}
        </p>
        <div className="sp-field">
          <label className="sp-label" htmlFor="pb-product">
            {P.search}
          </label>
          <div style={{ position: "relative" }}>
            <div className="sp-group">
              <Icon name="search" size={18} className="sp-input-icon" />
              <input
                id="pb-product"
                className="sp-input "
                placeholder={P.searchPh}
                value={q}
                autoComplete="off"
                onChange={(ev) => setQ(ev.target.value)}
                onFocus={() => setFocus(true)}
                onBlur={() => setTimeout(() => setFocus(false), 150)}
                data-testid="pb-search"
              />
            </div>
            {focus && needle && (
              <div className="sp-sug" role="listbox" aria-label={P.search} data-testid="pb-suggestions">
                {suggestions.length ? (
                  suggestions.map(({ p, u }) => (
                    <button key={u.conversionId} type="button" role="option" aria-selected={false} className="sp-menu-item" disabled={!u.barcode} title={u.barcode ? undefined : P.setBarcode} data-unit={u.conversionId} onMouseDown={() => u.barcode && add(u.conversionId)} style={{ height: "auto", minHeight: 36, padding: "6px 10px", flexWrap: "wrap", opacity: u.barcode ? 1 : 0.55 }}>
                      <span className="sp-code">
                        <bdi dir="ltr">{p.code}</bdi>
                      </span>
                      <span>{p.name}</span>
                      <span className={"sp-badge " + (u.isBase ? "sp-badge--info" : "sp-badge--neutral")}>{u.unitName}</span>
                      <span style={{ marginInlineStart: "auto", color: "var(--text-3)", fontWeight: 400 }}>{u.barcode ? <bdi dir="ltr">{u.barcode}</bdi> : P.noBarcode}</span>
                    </button>
                  ))
                ) : (
                  <div className="t-caption" style={{ padding: "8px 10px" }}>
                    {P.noResults}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="sp-table-card" style={{ boxShadow: "none" }}>
          <div className="sp-table-scroll">
            <table className="sp-table" data-testid="pb-items">
              <thead>
                <tr>
                  <th>{P.colProduct}</th>
                  <th>{P.colUnit}</th>
                  <th>{P.colBarcode}</th>
                  <th>{P.colQty}</th>
                  <th className="act">{P.colAction}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ color: "var(--text-3)" }}>
                      {P.noItems}
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const hit = byUnit.get(r.conversionId);
                  if (!hit) return null;
                  return (
                    <tr key={r.conversionId} data-unit={r.conversionId} data-code={hit.p.code}>
                      <td>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>
                          <bdi dir="ltr">{hit.p.code}</bdi>
                        </div>
                        <span className="sp-badge sp-badge--success">{hit.p.name}</span>
                      </td>
                      <td>
                        {hit.u.unitName} {hit.u.isBase && <span className="sp-badge sp-badge--info">{P.baseTag}</span>}
                      </td>
                      <td>
                        <bdi dir="ltr" data-testid="pb-barcode">
                          {hit.u.barcode}
                        </bdi>
                      </td>
                      <td style={{ width: "22%", minWidth: 110 }}>
                        <input className="sp-input " type="number" inputMode="numeric" min={1} max={MAX_LABELS_PER_ITEM} aria-label={P.colQty} value={r.qty} onChange={(ev) => setQty(r.conversionId, ev.target.value)} data-testid="pb-qty" dir="ltr" />
                      </td>
                      <td className="act">
                        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={fmt(P.removeAria, { name: `${hit.p.code} ${hit.u.unitName}` })} onClick={() => setRows(rows.filter((x) => x.conversionId !== r.conversionId))} data-testid="pb-remove" style={{ color: "var(--danger-500)" }}>
                          <Icon name="trash-2" size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="sp-pb-sw">
          <div className="sp-field">
            <label className="sp-label" htmlFor="pb-paper">
              {P.paper}
              <i>*</i>
            </label>
            <select
              id="pb-paper"
              className="sp-select "
              value={paper}
              onChange={(ev) => {
                const v = ev.target.value as PaperId | "";
                setPaper(v);
                setSize(""); // a layout belongs to ONE paper: choose it again
                setErr("");
              }}
              data-testid="pb-paper"
            >
              <option value="">{P.paperPh}</option>
              {PAPER_IDS.map((id) => (
                <option key={id} value={id}>
                  {P.papers[PAPERS[id].key]}
                </option>
              ))}
            </select>
          </div>
          <div className="sp-field">
            <label className="sp-label" htmlFor="pb-size">
              {P.layout}
              <i>*</i>
            </label>
            <select id="pb-size" className="sp-select " value={size} disabled={!paper} onChange={(ev) => setSize(ev.target.value as LabelSizeId | "")} data-testid="pb-size" title={paper ? undefined : P.layoutFirst}>
              <option value="">{paper ? P.layoutPh : P.layoutFirst}</option>
              {paper &&
                sizesFor(paper).map((s) => (
                  <option key={s.id} value={s.id}>
                    {P.sizes[s.key]}
                  </option>
                ))}
            </select>
          </div>
          <label className="sp-switch">
            <input type="checkbox" role="switch" checked={company} onChange={(ev) => setCompany(ev.target.checked)} data-testid="pb-company" />
            {P.showCompany}
          </label>
          <label className="sp-switch">
            <input type="checkbox" role="switch" checked={name} onChange={(ev) => setName(ev.target.checked)} data-testid="pb-name" />
            {P.showName}
          </label>
          <label className="sp-switch">
            <input type="checkbox" role="switch" checked={price} onChange={(ev) => setPrice(ev.target.checked)} data-testid="pb-price" />
            {P.showPrice}
          </label>
        </div>
        <p className="t-caption" style={{ margin: 0 }}>
          {P.sizeNote} {fmt(P.limits, { items: MAX_LABEL_ITEMS, labels: MAX_LABELS_TOTAL })}
        </p>

        {err && (
          <span className="sp-error" role="alert" data-testid="pb-error">
            {err}
          </span>
        )}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <button type="button" className="sp-btn sp-btn--primary" onClick={view} data-testid="pb-view">
            <Icon name="eye" size={18} />
            {P.viewLabels}
          </button>
          <button type="button" className="sp-btn sp-btn--danger" onClick={reset} data-testid="pb-reset">
            <Icon name="rotate-ccw" size={18} />
            {P.reset}
          </button>
        </div>
      </div>
    </div>
  );
}
