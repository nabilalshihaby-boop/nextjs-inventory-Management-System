"use client";

import { searchProducts } from "@/lib/product-lookup";
import Link from "next/link";
import { useMemo, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import InactiveLineNote from "@/components/products/InactiveLineNote";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import { ConfirmDeleteModal } from "@/components/ui/Modal";
import { createTransfer, updateTransfer, type TransferResult } from "@/app/(dashboard)/transfers/actions";
import { formatMoney, formatQuantity } from "@/lib/money";
import { LineUnitSelect, BaseHint } from "@/components/ui/LineUnit";
import { baseUnits, defaultLineUnit, findLineUnit, scalePrice, type ProductUnits } from "@/lib/unit-math";
import {
  fromUnits,
  isQuantity,
  lineTotalCents,
  toUnits,
  transferTotal,
  type StockOption,
  type TransferField,
  type TransferFormValues,
  type TransferStatusValue,
  type WarehouseOption,
} from "@/lib/transfers";

// Port of design/Create Transfer.html: PageHeader (+ Back), FormCard with Date / From Warehouse /
// To Warehouse, product search (suggestions), Order items table (quantity −/+ and remove), summary,
// Status and Note. Transfers never change product cost/price/tax/discount: the Net Unit Cost is a
// read-only snapshot of Product.cost, and the design's order tax / discount / shipping inputs and
// per-item edit modal are intentionally omitted (transfers create no financial entries).

type Currency = { code: string; symbol: string; right: boolean } | null;
/** A product line in the form; `available` is looked up from the selected source warehouse. */
/** `cost` is per LINE unit (base cost × factor); `baseCost` is the product cost per base unit (the server recomputes it). */
type Line = { productId: string; code: string; name: string; unit: string; cost: string; baseCost: string; quantity: string; unitId: string; unitInfo: ProductUnits; inactive?: boolean };

export default function TransferForm({
  warehouses,
  stock,
  currency,
  today,
  transferId,
  reference,
  initial,
  initialLines = [],
}: {
  warehouses: WarehouseOption[];
  stock: StockOption[];
  currency: Currency;
  today: string;
  transferId?: string;
  reference?: string;
  initial?: TransferFormValues;
  initialLines?: Omit<StockOption, "warehouseId" | "available">[];
}) {
  const router = useRouter();
  const T = useT();
  const F = T.transfers.form;
  const V = T.transfers.val;
  const editing = !!transferId;
  const [date, setDate] = useState(initial?.transferDate ?? today);
  const [from, setFrom] = useState(initial?.fromWarehouseId ?? "");
  const [to, setTo] = useState(initial?.toWarehouseId ?? "");
  const [status, setStatus] = useState<TransferStatusValue>(initial?.status ?? "PENDING");
  const [note, setNote] = useState(initial?.note ?? "");
  const [lines, setLines] = useState<Line[]>(() =>
    (initial?.items ?? []).flatMap((i) => {
      const p = initialLines.find((l) => l.productId === i.productId);
      if (!p) return [];
      const u = findLineUnit(p.unitInfo, i.unitId ?? "");
      return [{ ...p, baseCost: p.cost, cost: scalePrice(p.cost, u.factor), unitId: u.unitId, quantity: i.quantity }];
    }),
  );
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const [remove, setRemove] = useState<Line | null>(null);
  const [e, setE] = useState<Partial<Record<TransferField, string>>>({});
  const [itemErr, setItemErr] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  // On-hand stock in the selected source warehouse (server data; re-checked on save).
  const available = useMemo(() => new Map(stock.filter((s) => s.warehouseId === from).map((s) => [s.productId, s])), [stock, from]);
  const availableOf = (productId: string) => available.get(productId)?.available ?? "0.000";

  if (warehouses.length < 2) {
    return (
      <>
        <Header editing={editing} reference={reference} />
        <div className="sp-card" style={{ padding: "48px 24px", textAlign: "center" }} data-testid="transfer-needs-warehouses">
          <span style={{ display: "inline-grid", placeItems: "center", width: 56, height: 56, borderRadius: "50%", background: "var(--primary-50)", color: "var(--primary-700)", marginBottom: 16 }}>
            <Icon name="warehouse" size={26} />
          </span>
          <h2 className="t-section-title" style={{ margin: "0 0 8px" }}>
            {F.needTitle}
          </h2>
          <p className="t-body" style={{ margin: "0 0 20px", color: "var(--text-2)" }}>
            {F.needBody} {warehouses.length === 0 ? F.noWarehouses : F.oneWarehouse} {F.needAdd}
          </p>
          <Link href="/warehouse" className="sp-btn sp-btn--primary">
            <Icon name="warehouse" size={18} />
            {F.goWarehouse}
          </Link>
        </div>
      </>
    );
  }

  const needle = q.trim().toLowerCase();
  const suggestions = from && needle
    ? searchProducts([...available.values()].filter((s) => !s.inactive), needle)
    : [];

  const clearErr = (k: TransferField) => setE((x) => ({ ...x, [k]: "" }));
  const setQty = (productId: string, quantity: string) => {
    setLines((ls) => ls.map((l) => (l.productId === productId ? { ...l, quantity } : l)));
    setItemErr((x) => ({ ...x, [productId]: "" }));
    clearErr("items");
  };

  function add(s: StockOption) {
    setQ("");
    if (lines.some((l) => l.productId === s.productId)) {
      toast(fmt(F.already, { name: s.name }), { id: "transfer", icon: "ℹ️" });
      return;
    }
    const du = defaultLineUnit(s.unitInfo, "ANY");
    setLines([...lines, { productId: s.productId, code: s.code, name: s.name, unit: s.unit, cost: scalePrice(s.cost, du.factor), baseCost: s.cost, quantity: "1", unitId: du.unitId, unitInfo: s.unitInfo }]);
    clearErr("items");
  }

  function changeFrom(v: string) {
    setFrom(v);
    clearErr("fromWarehouseId");
    if (v === to) setE((x) => ({ ...x, toWarehouseId: V.sameWarehouse }));
    else clearErr("toWarehouseId");
    // Stock differs per warehouse — the items must be picked again from the new source.
    if (lines.length) {
      setLines([]);
      setItemErr({});
      toast(F.sourceChanged, { id: "transfer", icon: "ℹ️" });
    }
  }

  const step = (l: Line, dir: 1 | -1) => {
    const cur = isQuantity(l.quantity) ? toUnits(l.quantity, 3) : BigInt(0);
    const max = toUnits(availableOf(l.productId), 3);
    const factor = findLineUnit(l.unitInfo, l.unitId).factor;
    const next = cur + BigInt(dir) * BigInt(1000);
    if (dir === -1 && next <= BigInt(0)) return; // quantity must stay above 0
    // Stock is counted in BASE units: the quantity in the line's unit is converted before comparing.
    if (dir === 1 && baseUnits(fromUnits(next, 3), factor) > max) {
      toast.error(fmt(F.onlyUnits, { qty: formatQuantity(availableOf(l.productId)), unit: l.unitInfo.baseUnit }), { id: "transfer" });
      return;
    }
    setQty(l.productId, formatQuantity(fromUnits(next, 3)).replace(/,/g, ""));
  };

  function save() {
    const n: Partial<Record<TransferField, string>> = {};
    const ie: Record<string, string> = {};
    if (!date) n.transferDate = V.dateRequired;
    if (!from) n.fromWarehouseId = V.fromRequired;
    if (!to) n.toWarehouseId = V.toRequired;
    else if (from && from === to) n.toWarehouseId = V.sameWarehouse;
    if (!lines.length) n.items = V.addItem;
    for (const l of lines) {
      if (!isQuantity(l.quantity)) ie[l.productId] = V.qtyHint;
      else if (baseUnits(l.quantity, findLineUnit(l.unitInfo, l.unitId).factor) > toUnits(availableOf(l.productId), 3)) ie[l.productId] = fmt(V.onlyAvail, { qty: formatQuantity(availableOf(l.productId)) });
    }
    if (Object.keys(ie).length) n.items ??= Object.values(ie)[0];
    setE(n);
    setItemErr(ie);
    if (Object.keys(n).length) {
      toast.error(Object.values(n)[0]!, { id: "transfer" });
      return;
    }
    // Only ids, quantities, date, status and note are sent — never cost or stock.
    const payload = { transferDate: date, fromWarehouseId: from, toWarehouseId: to, status, note, items: lines.map((l) => ({ productId: l.productId, unitId: l.unitId, quantity: l.quantity.trim() })) };
    startTransition(async () => {
      let r: TransferResult;
      try {
        r = editing ? await updateTransfer(transferId, payload) : await createTransfer(payload);
      } catch {
        toast.error(T.common.somethingWrong, { id: "transfer" });
        return;
      }
      if (!r.ok) {
        if (r.fieldErrors) setE(r.fieldErrors);
        if (r.itemErrors) setItemErr(r.itemErrors);
        toast.error(r.message, { id: "transfer" });
        router.refresh(); // pick up current stock
        return;
      }
      toast.success(r.message, { id: "transfer" });
      router.push(r.id ? `/transfers/${encodeURIComponent(r.id)}` : "/transfers");
      router.refresh();
    });
  }

  const money = (v: string) => formatMoney(v, currency);
  const total = transferTotal(lines.filter((l) => isQuantity(l.quantity)).map((l) => ({ quantity: l.quantity, unitCost: l.cost })));
  // Total quantity is counted in BASE units (lines may use different units).
  const totalQty = fromUnits(lines.reduce((a, l) => a + baseUnits(l.quantity, findLineUnit(l.unitInfo, l.unitId).factor), BigInt(0)), 3);
  const field = (k: TransferField, label: string, required: boolean, child: React.ReactNode, style?: CSSProperties) => (
    <div className={"sp-field" + (e[k] ? " sp-field--error" : "")} style={style}>
      <label className="sp-label" htmlFor={`tr-${k}`}>
        {label}
        {required && <i>*</i>}
      </label>
      {child}
      {e[k] && <span className="sp-error">{e[k]}</span>}
    </div>
  );
  const whSelect = (k: "fromWarehouseId" | "toWarehouseId", value: string, onChange: (v: string) => void, placeholder: string) => (
    <select id={`tr-${k}`} className={"sp-select " + (value ? "" : "sp-select--placeholder")} value={value} disabled={lines.some((l) => l.inactive)} title={lines.some((l) => l.inactive) ? T.products.status.keptWarehouse : undefined} onChange={(ev) => onChange(ev.target.value)} aria-invalid={!!e[k] || undefined}>
      <option value="" disabled>
        {placeholder}
      </option>
      {warehouses.map((w) => (
        <option key={w.value} value={w.value}>
          {w.label}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <Header editing={editing} reference={reference} />
      {!currency && (
        <div className="sp-badge sp-badge--warning" role="status" style={{ height: "auto", padding: "10px 14px", whiteSpace: "normal", marginBottom: 16 }}>
          <Icon name="info" size={16} />
          <span>
            {F.noCurrencyA}
            <Link href="/settings">{F.systemSettings}</Link>.
          </span>
        </div>
      )}
      <form
        noValidate
        aria-busy={pending}
        onSubmit={(ev) => {
          ev.preventDefault();
          save();
        }}
      >
        <div className="sp-card sp-form-card">
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div className="sp-form-grid" style={{ "--cols": 3 } as CSSProperties}>
              {field("transferDate", F.date, true, (
                <input id="tr-transferDate" type="date" className="sp-input " value={date} onChange={(ev) => { setDate(ev.target.value); clearErr("transferDate"); }} aria-invalid={!!e.transferDate || undefined} />
              ))}
              {field("fromWarehouseId", F.from, true, whSelect("fromWarehouseId", from, changeFrom, F.fromPh))}
              {field("toWarehouseId", F.to, true, whSelect("toWarehouseId", to, (v) => {
                setTo(v);
                setE((x) => ({ ...x, toWarehouseId: v && v === from ? V.sameWarehouse : "" }));
              }, F.toPh))}
            </div>

            <div className="sp-field">
              <label className="sp-label" htmlFor="tr-product">
                {F.product}
              </label>
              <div style={{ position: "relative" }}>
                <div className="sp-group">
                  <Icon name="search" size={18} className="sp-input-icon" />
                  <input
                    id="tr-product"
                    className="sp-input "
                    placeholder={from ? F.productPh : F.productPhNoFrom}
                    value={q}
                    disabled={!from}
                    autoComplete="off"
                    onChange={(ev) => setQ(ev.target.value)}
                    onFocus={() => setFocus(true)}
                    onBlur={() => setTimeout(() => setFocus(false), 150)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter") {
                        ev.preventDefault();
                        if (suggestions[0]) add(suggestions[0]);
                      }
                    }}
                  />
                </div>
                {focus && needle && (
                  <div className="sp-sug" role="listbox" aria-label={F.productsAria}>
                    {suggestions.length ? (
                      suggestions.map((s) => (
                        <button key={s.productId} type="button" role="option" aria-selected={false} className="sp-menu-item" onMouseDown={() => add(s)}>
                          <span className="sp-code"><bdi dir="ltr">{s.code}</bdi></span>
                          {s.name}
                          <span style={{ marginInlineStart: "auto", color: "var(--text-3)", fontWeight: 400 }}>
                            <bdi dir="ltr">{formatQuantity(s.available)}</bdi> {s.unitInfo.baseUnit}
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="t-caption" style={{ padding: "8px 10px" }}>
                        {fmt(F.noMatch, { q: q.trim() })}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {from && available.size === 0 && <span className="sp-hint">{F.noStock}</span>}
            </div>

            <div className={"sp-field" + (e.items ? " sp-field--error" : "")}>
              <span className="sp-label">
                {F.items}<i>*</i>
              </span>
              <div className="sp-table-card" style={{ boxShadow: "none" }}>
                <div className="sp-table-scroll">
                  <table className="sp-table" data-testid="transfer-items">
                    <thead>
                      <tr>
                        <th>{F.colProduct}</th>
                        <th>{F.colCost}</th>
                        <th>{F.colStock}</th>
                        <th>{F.colQty}</th>
                        <th>{F.colSubtotal}</th>
                        <th className="act">{F.colAction}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.length === 0 && (
                        <tr>
                          <td colSpan={6} style={{ color: "var(--text-3)" }}>
                            {F.noItems}
                          </td>
                        </tr>
                      )}
                      {lines.map((l) => (
                        <tr key={l.productId} style={{ height: 80 }} data-product={l.code}>
                          <td style={{ padding: "12px 20px" }}>
                            <div style={{ fontWeight: 600, marginBottom: 4 }}><bdi dir="ltr">{l.code}</bdi></div>
                            <span className="sp-badge sp-badge--success">{l.name}</span>
                            {l.inactive && <InactiveLineNote />}
                            {itemErr[l.productId] && (
                              <div className="sp-error" style={{ marginTop: 6 }}>
                                {itemErr[l.productId]}
                              </div>
                            )}
                          </td>
                          <td><bdi dir="ltr">{money(l.cost)}</bdi></td>
                          <td>
                            <span className="sp-badge sp-badge--warning">
                              <bdi dir="ltr">{formatQuantity(availableOf(l.productId))}</bdi> {l.unitInfo.baseUnit}
                            </span>
                          </td>
                          <td>
                            <span className="sp-qty">
                              <button type="button" className="sp-btn sp-btn--secondary sp-btn--icon" aria-label={fmt(F.decreaseAria, { name: l.name })} disabled={l.inactive} onClick={() => step(l, -1)}>
                                <Icon name="minus" size={18} />
                              </button>
                              <input
                                className="sp-input"
                                aria-label={fmt(F.qtyAria, { name: l.name })}
                                inputMode="decimal"
                                dir="ltr"
                                readOnly={l.inactive}
                                value={l.quantity}
                                aria-invalid={!!itemErr[l.productId] || undefined}
                                onChange={(ev) => setQty(l.productId, ev.target.value)}
                              />
                              <button type="button" className="sp-btn sp-btn--secondary sp-btn--icon" aria-label={fmt(F.increaseAria, { name: l.name })} disabled={l.inactive} onClick={() => step(l, 1)}>
                                <Icon name="plus" size={18} />
                              </button>
                            </span>
                            {l.inactive ? (
                              <span className="t-caption" style={{ display: "block" }}>{findLineUnit(l.unitInfo, l.unitId).name}</span>
                            ) : (
                              <LineUnitSelect info={l.unitInfo} purpose="ANY" value={l.unitId} compact onChange={(unitId) => setLines((ls) => ls.map((x) => (x.productId === l.productId ? { ...x, unitId, cost: scalePrice(x.baseCost, findLineUnit(x.unitInfo, unitId).factor) } : x)))} />
                            )}
                            <BaseHint info={l.unitInfo} unitId={l.unitId} qty={l.quantity} />
                          </td>
                          <td><bdi dir="ltr">{isQuantity(l.quantity) ? money(fromUnits(lineTotalCents(l.quantity, l.cost), 2)) : "—"}</bdi></td>
                          <td className="act">
                            <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={fmt(F.removeAria, { name: l.name })} style={{ color: "var(--danger-500)" }} onClick={() => setRemove(l)}>
                              <Icon name="trash-2" size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {e.items && <span className="sp-error">{e.items}</span>}
            </div>

            <div className="sp-sum" data-testid="transfer-summary">
              <div>
                <span>{F.sumItems}</span>
                <span>{lines.length}</span>
              </div>
              <div>
                <span>{F.sumQty}</span>
                <span><bdi dir="ltr">{formatQuantity(totalQty)}</bdi></span>
              </div>
              <div>
                <span>{F.sumTotal}</span>
                <span data-testid="transfer-total"><bdi dir="ltr">{money(total)}</bdi></span>
              </div>
            </div>

            {field("status", F.status, true, (
              <>
                <select id="tr-status" className="sp-select " value={status} onChange={(ev) => { setStatus(ev.target.value as TransferStatusValue); clearErr("status"); }}>
                  {(["COMPLETED", "SENT", "PENDING"] as const).map((v) => (
                    <option key={v} value={v}>
                      {T.transfers.status[v]}
                    </option>
                  ))}
                </select>
                <span className="sp-hint">
                  {status === "PENDING" && F.hintPending}
                  {status === "SENT" && F.hintSent}
                  {status === "COMPLETED" && F.hintCompleted}
                </span>
              </>
            ), { width: "33%", minWidth: 260 })}

            {field("note", F.note, false, (
              <textarea id="tr-note" className="sp-textarea " rows={4} placeholder={F.notePh} value={note} maxLength={2000} onChange={(ev) => setNote(ev.target.value)} />
            ))}
          </div>
          <div className="sp-form-actions">
            <button type="button" className="sp-btn sp-btn--secondary" onClick={() => router.push(editing ? `/transfers/${encodeURIComponent(transferId)}` : "/transfers")} disabled={pending}>
              {F.cancel}
            </button>
            <button type="submit" className="sp-btn sp-btn--primary" disabled={pending}>
              {pending ? T.common.saving : T.common.save}
            </button>
          </div>
        </div>
      </form>

      {remove && (
        <ConfirmDeleteModal
          itemType={F.productType}
          itemName={remove.name}
          onCancel={() => setRemove(null)}
          onConfirm={() => {
            setLines(lines.filter((x) => x.productId !== remove.productId));
            setRemove(null);
          }}
        />
      )}
    </>
  );
}

function Header({ editing, reference }: { editing: boolean; reference?: string }) {
  const T = useT();
  return (
    <div className="sp-page-head">
      <h1 className="t-page-title" style={{ margin: 0 }}>
        {editing ? `${T.transfers.editTitle}${reference ? ` ${reference}` : ""}` : T.transfers.createTitle}
      </h1>
      <div style={{ display: "flex", gap: 12 }}>
        <Link href="/transfers" className="sp-btn sp-btn--secondary">
          <Icon name="arrow-left" size={18} />
          {T.transfers.form.back}
        </Link>
      </div>
    </div>
  );
}
