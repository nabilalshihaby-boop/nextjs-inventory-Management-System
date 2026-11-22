"use client";

import Link from "next/link";
import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { ConfirmDeleteModal } from "@/components/ui/Modal";
import { createPurchaseReturn, type PurchaseReturnResult } from "@/app/(dashboard)/purchases/returns/actions";
import { formatMoney, formatQuantity } from "@/lib/money";
import { fromUnits, isQuantity, toUnits } from "@/lib/transfers";
import { calcReturn } from "@/lib/purchase-return-calc";
import type { PurchaseReturnField, ReturnSourceLine, ReturnSourcePurchase } from "@/lib/purchase-returns";
import { useT } from "@/components/i18n/I18nProvider";
import { baseUnits } from "@/lib/unit-math";
import { fmt } from "@/lib/i18n/config";

// Port of design/Create Purchase Return.html: PageHeader (+ Back), FormCard with Date / Warehouse /
// Supplier, the Order items table (Product / Net Unit Cost / Stock / Qty −/+ / Discount / Tax /
// Subtotal / remove), the summary (Order Tax / Discount / Shipping / Grand Total), Status and Notes.
// Adapted for a return of a real purchase: the product search becomes the "Purchase" picker
// (Received purchases only); Warehouse and Supplier come from that purchase (read-only); lines are
// the purchase's own lines; prices are the original snapshot (no item-edit modal, no order tax /
// discount / shipping inputs — those are shared out automatically, shipping isn't returned).
// Totals here are a preview from the same calculation the server uses on save.

export default function PurchaseReturnForm({ sources, today, initialPurchase }: { sources: ReturnSourcePurchase[]; today: string; initialPurchase: string }) {
  const router = useRouter();
  const T = useT();
  const R = T.purchaseReturns;
  const F = R.form;
  const [date, setDate] = useState(today);
  const [purchaseId, setPurchaseId] = useState(initialPurchase);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [remove, setRemove] = useState<ReturnSourceLine | null>(null);
  const [e, setE] = useState<Partial<Record<PurchaseReturnField, string>>>({});
  const [itemErr, setItemErr] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const src = sources.find((s) => s.id === purchaseId) ?? null;
  const money = (v: string) => formatMoney(v, src?.currency ?? null);
  const returnable = (l: ReturnSourceLine) => fromUnits(toUnits(l.quantity, 3) - toUnits(l.returned, 3), 3);
  const lines = src ? src.lines.filter((l) => !removed.has(l.purchaseItemId) && toUnits(returnable(l), 3) > BigInt(0)) : [];
  const q = (id: string) => qty[id] ?? "0";
  const chosen = lines.filter((l) => isQuantity(q(l.purchaseItemId)));
  const calc = src
    ? calcReturn(
        { subtotal: src.subtotal, orderTaxAmount: src.orderTaxAmount, discount: src.discount, returnedSubtotal: src.returnedSubtotal },
        chosen.map((l) => ({ original: { quantity: l.quantity, subtotal: l.subtotal, taxAmount: l.taxAmount, discountAmount: l.discountAmount, returned: l.returned }, quantity: q(l.purchaseItemId) })),
      )
    : null;
  const lineCalc = (l: ReturnSourceLine) => (calc ? calc.lines[chosen.findIndex((c) => c.purchaseItemId === l.purchaseItemId)] : undefined);

  const pick = (id: string) => {
    setPurchaseId(id);
    setQty({});
    setRemoved(new Set());
    setItemErr({});
    setE({});
  };
  const setLine = (id: string, v: string) => {
    setQty((x) => ({ ...x, [id]: v }));
    setItemErr((x) => ({ ...x, [id]: "" }));
    setE((x) => ({ ...x, items: "" }));
  };
  const step = (l: ReturnSourceLine, dir: 1 | -1) => {
    const cur = isQuantity(q(l.purchaseItemId)) ? toUnits(q(l.purchaseItemId), 3) : BigInt(0);
    let next = cur + BigInt(dir) * BigInt(1000);
    const max = toUnits(returnable(l), 3);
    if (next < BigInt(0)) next = BigInt(0);
    // Stock is counted in BASE units: the quantity in the line's unit is converted before comparing with it.
    if (next > BigInt(0) && baseUnits(fromUnits(next, 3), l.factor) > toUnits(l.stock, 3)) {
      toast.error(fmt(F.onlyStock, { max: formatQuantity(l.stock), warehouse: src?.warehouse ?? "" }), { id: "return" });
      return;
    }
    if (next > max) {
      next = max;
      toast.error(fmt(F.atMost, { max: formatQuantity(fromUnits(max, 3)), unit: l.unit }), { id: "return" });
    }
    setLine(l.purchaseItemId, formatQuantity(fromUnits(next, 3)).replace(/,/g, ""));
  };

  function problem(l: ReturnSourceLine): string {
    const v = q(l.purchaseItemId).trim();
    if (v === "" || v === "0") return "";
    if (!/^\d{1,11}(\.\d{1,3})?$/.test(v)) return F.qtyDecimals;
    if (toUnits(v, 3) > toUnits(returnable(l), 3)) return fmt(F.onlyCan, { max: formatQuantity(returnable(l)) });
    if (baseUnits(v, l.factor) > toUnits(l.stock, 3)) return fmt(F.onlyStock, { max: formatQuantity(l.stock), warehouse: src?.warehouse ?? "" });
    return "";
  }

  function save() {
    const n: Partial<Record<PurchaseReturnField, string>> = {};
    const ie: Record<string, string> = {};
    if (!src) n.purchaseId = R.val.choosePurchase;
    if (!date) n.returnDate = T.purchases.val.dateRequired;
    else if (date > today) n.returnDate = T.purchases.val.dateFuture;
    else if (src && date < src.date) n.returnDate = fmt(F.dateBefore, { date: src.dateLabel });
    for (const l of lines) {
      const p = problem(l);
      if (p) ie[l.purchaseItemId] = p;
    }
    const send = lines.filter((l) => isQuantity(q(l.purchaseItemId)) && !ie[l.purchaseItemId]);
    if (src && !Object.keys(ie).length && !send.length) n.items = R.val.minLine;
    if (Object.keys(ie).length) n.items = Object.values(ie)[0];
    else if (src && calc && toUnits(calc.grandTotal, 2) > toUnits(src.due, 2)) n.items = fmt(R.err.dueExceeded, { worth: money(calc.grandTotal), due: money(src.due), ref: src.reference });
    setE(n);
    setItemErr(ie);
    if (Object.keys(n).length) return void toast.error(Object.values(n)[0]!, { id: "return" });
    // Ids and quantities only — the server re-reads prices, stock and history.
    const payload = { returnDate: date, purchaseId, notes, items: send.map((l) => ({ purchaseItemId: l.purchaseItemId, quantity: q(l.purchaseItemId).trim() })) };
    startTransition(async () => {
      let r: PurchaseReturnResult;
      try {
        r = await createPurchaseReturn(payload);
      } catch {
        return void toast.error(T.common.somethingWrong, { id: "return" });
      }
      if (!r.ok) {
        if (r.fieldErrors) setE(r.fieldErrors);
        if (r.itemErrors) setItemErr(r.itemErrors);
        toast.error(r.message, { id: "return", duration: 7000 });
        router.refresh(); // current stock / returnable quantities
        return;
      }
      toast.success(r.message, { id: "return", duration: 6000 });
      router.push(r.id ? `/purchases/returns/${encodeURIComponent(r.id)}` : "/purchases/returns");
      router.refresh();
    });
  }

  const field = (k: PurchaseReturnField | "warehouse" | "supplier" | "status", label: string, child: ReactNode, required = false, style?: CSSProperties, hint?: ReactNode) => (
    <div className={"sp-field" + (e[k as PurchaseReturnField] ? " sp-field--error" : "")} style={style}>
      <label className="sp-label" htmlFor={`pr-${k}`}>
        {label}
        {required && <i>*</i>}
      </label>
      {child}
      {e[k as PurchaseReturnField] ? <span className="sp-error" id={`pr-${k}-error`}>{e[k as PurchaseReturnField]}</span> : hint ? <span className="sp-hint">{hint}</span> : null}
    </div>
  );

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {F.title}
        </h1>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/purchases/returns" className="sp-btn sp-btn--secondary">
            <Icon name="arrow-left" size={18} />
            {F.back}
          </Link>
        </div>
      </div>

      {sources.length === 0 ? (
        <div className="sp-card sp-empty" data-testid="return-setup">
          <Icon name="receipt" size={36} />
          <div className="t-section-title">{F.noPurchasesTitle}</div>
          <span>{F.noPurchasesBody}</span>
          <Link href="/purchases" className="sp-btn sp-btn--secondary">
            {F.goPurchases}
          </Link>
        </div>
      ) : (
        <form noValidate aria-busy={pending} onSubmit={(ev) => { ev.preventDefault(); save(); }}>
          <div className="sp-card sp-form-card">
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <div className="sp-form-grid" style={{ "--cols": 3 } as CSSProperties}>
                {field("returnDate", F.date, <input id="pr-returnDate" type="date" className="sp-input " min={src?.date} max={today} value={date} onChange={(ev) => { setDate(ev.target.value); setE((x) => ({ ...x, returnDate: "" })); }} aria-invalid={!!e.returnDate || undefined} />, true)}
                {field("warehouse", F.warehouse, <select id="pr-warehouse" className="sp-select " disabled value="w"><option value="w">{src?.warehouse ?? F.fromPurchase}</option></select>, true)}
                {field("supplier", F.supplier, <select id="pr-supplier" className="sp-select " disabled value="s"><option value="s">{src?.supplier ?? F.fromPurchase}</option></select>, true)}
              </div>

              {field(
                "purchaseId",
                F.purchase,
                <select id="pr-purchaseId" className={"sp-select " + (purchaseId ? "" : "sp-select--placeholder")} value={purchaseId} onChange={(ev) => pick(ev.target.value)} aria-invalid={!!e.purchaseId || undefined}>
                  <option value="" disabled>
                    {F.choosePurchase}
                  </option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {fmt(F.purchaseOption, { ref: s.reference, supplier: s.supplier, date: s.dateLabel })}
                    </option>
                  ))}
                </select>,
                true,
                undefined,
                src ? fmt(F.stillUnpaid, { ref: src.reference, due: money(src.due) }) : F.onlyReceived,
              )}

              <div className={"sp-field" + (e.items ? " sp-field--error" : "")}>
                <span className="sp-label">
                  {F.orderItems}<i>*</i>
                </span>
                <div className="sp-table-card" style={{ boxShadow: "none" }}>
                  <div className="sp-table-scroll">
                    <table className="sp-table" data-testid="return-items">
                      <thead>
                        <tr>
                          <th>{F.colProduct}</th>
                          <th>{F.colNet}</th>
                          <th>{F.colStock}</th>
                          <th>{F.colQty}</th>
                          <th>{F.colDiscount}</th>
                          <th>{F.colTax}</th>
                          <th>{F.colSubtotal}</th>
                          <th className="act">{F.colAction}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.length === 0 && (
                          <tr>
                            <td colSpan={8} style={{ color: "var(--text-3)" }}>
                              {src ? F.noItems : F.chooseToLoad}
                            </td>
                          </tr>
                        )}
                        {lines.map((l) => {
                          const c = lineCalc(l);
                          return (
                            <tr key={l.purchaseItemId} style={{ height: 80 }} data-product={l.code}>
                              <td style={{ padding: "12px 20px" }}>
                                <div style={{ fontWeight: 600, marginBottom: 4 }}>{l.code}</div>
                                <span className="sp-badge sp-badge--success">{l.name}</span>
                                <div className="t-caption" style={{ marginTop: 6 }} data-testid="returnable">
                                  {fmt(F.returnable, { bought: formatQuantity(l.quantity), returned: formatQuantity(l.returned), returnable: formatQuantity(returnable(l)), unit: l.unit })}
                                </div>
                                {itemErr[l.purchaseItemId] && (
                                  <div className="sp-error" style={{ marginTop: 6 }}>
                                    {itemErr[l.purchaseItemId]}
                                  </div>
                                )}
                              </td>
                              <td>{money(l.netUnitCost)}</td>
                              <td>
                                <span className="sp-badge sp-badge--warning" data-testid="stock">
                                  {formatQuantity(l.stock)} {l.baseUnit}
                                </span>
                              </td>
                              <td>
                                <span className="sp-qty">
                                  <button type="button" className="sp-btn sp-btn--secondary sp-btn--icon" aria-label={fmt(F.decrease, { name: l.name })} onClick={() => step(l, -1)}>
                                    <Icon name="minus" size={18} />
                                  </button>
                                  <input className="sp-input" aria-label={fmt(F.qtyOf, { name: l.name })} inputMode="decimal" value={q(l.purchaseItemId)} onChange={(ev) => setLine(l.purchaseItemId, ev.target.value)} />
                                  <button type="button" className="sp-btn sp-btn--secondary sp-btn--icon" aria-label={fmt(F.increase, { name: l.name })} onClick={() => step(l, 1)}>
                                    <Icon name="plus" size={18} />
                                  </button>
                                </span>
                              </td>
                              <td data-col="discount">{money(c?.discountAmount ?? "0.00")}</td>
                              <td data-col="tax">{money(c?.taxAmount ?? "0.00")}</td>
                              <td data-col="subtotal">{money(c?.subtotal ?? "0.00")}</td>
                              <td className="act">
                                <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={fmt(F.remove, { name: l.name })} style={{ color: "var(--danger-500)" }} onClick={() => setRemove(l)}>
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
                {e.items && <span className="sp-error">{e.items}</span>}
              </div>

              <div className="sp-sum" data-testid="return-summary">
                <div>
                  <span>{F.orderTax}</span>
                  <span data-testid="sum-tax">
                    {money(calc?.orderTaxAmount ?? "0.00")} ({src ? src.orderTaxRate : "0.00"}) %
                  </span>
                </div>
                <div>
                  <span>{F.discount}</span>
                  <span data-testid="sum-discount">{money(calc?.discount ?? "0.00")}</span>
                </div>
                <div>
                  <span>{F.shipping}</span>
                  <span data-testid="sum-shipping">{money("0.00")}</span>
                </div>
                <div>
                  <span>{F.grandTotal}</span>
                  <span data-testid="sum-grand">{money(calc?.grandTotal ?? "0.00")}</span>
                </div>
              </div>
              <span className="t-caption">{F.note}</span>

              {field("status", F.status, <select id="pr-status" className="sp-select " disabled value="c"><option value="c">{F.completed}</option></select>, true, { width: "33%", minWidth: 260 }, F.statusHint)}
              {field("notes", F.notes, <textarea id="pr-notes" className="sp-textarea " rows={4} placeholder={F.notesPh} maxLength={2000} value={notes} onChange={(ev) => setNotes(ev.target.value)} />)}
            </div>
            <div className="sp-form-actions">
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => router.push("/purchases/returns")} disabled={pending}>
                {F.cancel}
              </button>
              <button type="submit" className="sp-btn sp-btn--primary" disabled={pending}>
                {pending ? F.saving : F.save}
              </button>
            </div>
          </div>
        </form>
      )}

      {remove && (
        <ConfirmDeleteModal
          itemType={F.productType}
          itemName={remove.name}
          onCancel={() => setRemove(null)}
          onConfirm={() => {
            setRemoved(new Set([...removed, remove.purchaseItemId]));
            setRemove(null);
          }}
        />
      )}
    </>
  );
}
