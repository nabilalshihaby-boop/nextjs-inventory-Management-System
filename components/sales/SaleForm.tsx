"use client";

import { searchProducts } from "@/lib/product-lookup";
import Link from "next/link";
import { Fragment, useMemo, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import Modal, { ConfirmDeleteModal } from "@/components/ui/Modal";
import { createSale, updateSale, type SaleResult } from "@/app/(dashboard)/sales/actions";
import { formatMoney, formatQuantity } from "@/lib/money";
import { fromUnits, isQuantity, toUnits } from "@/lib/transfers";
import { type QuotationLineInput } from "@/lib/quotations";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import { tr } from "@/lib/i18n/messages";
import { LineUnitSelect, BaseHint } from "@/components/ui/LineUnit";
import { baseUnits, defaultLineUnit, findLineUnit, scalePrice } from "@/lib/unit-math";
import { SALE_STATUSES, calcSale, type SaleCurrency, type SaleDraft, type SaleField, type SaleOption, type SaleProduct, type SaleStatusValue, type SaleStockLevel } from "@/lib/sales";

// Port of design/Create Sale.html: PageHeader (+ Back), FormCard with Date / Warehouse / Customer,
// product search, Order items table (Product + edit-item pencil / Net Unit Price / Stock / Qty −/+ /
// Discount / Tax / Subtotal / remove), summary (Order Tax / Discount / Shipping / Grand Total),
// Order Tax / Discount / Shipping inputs, Status + Payment Status, Notes, and the per-item modal
// (Product Price, Tax Type, Order Tax, Discount Type, Discount, Sale Unit). Also edits a Pending sale.
// Totals are a preview from the same calculation the server uses on save. Line edits apply to this
// sale only — the product's own price and tax are never changed. Stock is shown for reference; the
// server re-checks it inside the transaction (Completed deducts it, Pending doesn't). Payment Status
// is always Unpaid here: customer payments aren't built yet.

type Line = SaleProduct & { unitId: string; quantity: string; unitPrice: string; discountType: "FIXED" | "PERCENTAGE"; discountValue: string };
const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
const PCT_RE = /^\d{1,3}(\.\d{1,2})?$/;
const okMoney = (v: string) => MONEY_RE.test(v.trim());
const okPct = (v: string) => PCT_RE.test(v.trim()) && Number(v) <= 100;
/** Inputs safe for the live preview (invalid values count as 0 until fixed). */
const safe = (l: Line): QuotationLineInput => ({
  quantity: isQuantity(l.quantity) ? l.quantity.trim() : "0",
  unitPrice: okMoney(l.unitPrice) ? l.unitPrice.trim() : "0",
  taxType: l.taxType,
  taxRate: okPct(l.taxRate) ? l.taxRate.trim() : "0",
  discountType: l.discountType,
  discountValue: (l.discountType === "FIXED" ? okMoney(l.discountValue) : okPct(l.discountValue)) ? l.discountValue.trim() : "0",
});

export default function SaleForm({
  customers,
  warehouses,
  products,
  stock,
  currency: defaultCurrency,
  today,
  canOpenSettings,
  draft,
}: {
  customers: SaleOption[];
  warehouses: SaleOption[];
  products: SaleProduct[];
  stock: SaleStockLevel[];
  currency: SaleCurrency | null;
  today: string;
  canOpenSettings: boolean;
  draft?: SaleDraft;
}) {
  const router = useRouter();
  const T = useT();
  const S = T.sales;
  const F = S.form;
  const editing = !!draft;
  // An existing sale keeps its own currency; new sales use the default currency.
  const currency = draft?.currency ?? defaultCurrency;
  const [date, setDate] = useState(draft?.saleDate ?? today);
  const [warehouseId, setWarehouseId] = useState(draft?.warehouseId ?? (warehouses.length === 1 ? warehouses[0].value : ""));
  const [customerId, setCustomerId] = useState(draft?.customerId ?? "");
  const [lines, setLines] = useState<Line[]>(draft?.lines ?? []);
  const [orderTaxRate, setOrderTaxRate] = useState(draft?.orderTaxRate ?? "0");
  const [discount, setDiscount] = useState(draft?.discount ?? "0");
  const [shipping, setShipping] = useState(draft?.shipping ?? "0");
  const [notes, setNotes] = useState(draft?.notes ?? "");
  const [status, setStatus] = useState<SaleStatusValue>(draft ? "PENDING" : "COMPLETED");
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const [edit, setEdit] = useState<Line | null>(null);
  const [remove, setRemove] = useState<Line | null>(null);
  const [e, setE] = useState<Partial<Record<SaleField, string>>>({});
  const [itemErr, setItemErr] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const onHand = useMemo(() => new Map(stock.filter((s) => s.warehouseId === warehouseId).map((s) => [s.productId, s.quantity])), [stock, warehouseId]);
  const money = (v: string) => formatMoney(v, currency);
  const back = draft ? `/sales/${encodeURIComponent(draft.id)}` : "/sales";

  const missing: { key: string; text: ReactNode }[] = [];
  if (!currency) missing.push({ key: "currency", text: canOpenSettings ? <Link href="/settings">{F.setupCurrency}</Link> : <>{F.setupCurrencyAsk}</> });
  if (!warehouses.length) missing.push({ key: "warehouse", text: <Link href="/warehouse/create">{F.setupWarehouse}</Link> });
  if (!customers.length) missing.push({ key: "customer", text: <Link href="/customers/create">{F.setupCustomer}</Link> });
  if (!products.length) missing.push({ key: "product", text: <Link href="/products/create">{F.setupProduct}</Link> });
  const blocked = missing.length > 0;

  const calc = calcSale(lines.map(safe), { orderTaxRate: okPct(orderTaxRate) ? orderTaxRate.trim() : "0", discount: okMoney(discount) ? discount.trim() : "0", shipping: okMoney(shipping) ? shipping.trim() : "0" });
  const needle = q.trim().toLowerCase();
  const suggestions = needle ? searchProducts(products, needle) : [];

  const patch = (productId: string, p: Partial<Line>) => {
    setLines((ls) => ls.map((l) => (l.productId === productId ? { ...l, ...p } : l)));
    setItemErr((x) => ({ ...x, [productId]: "" }));
    setE((x) => ({ ...x, items: "" }));
  };
  function add(p: SaleProduct) {
    setQ("");
    if (lines.some((l) => l.productId === p.productId)) return void toast(fmt(F.alreadyInItems, { name: p.name }), { id: "sale", icon: "ℹ️" });
    const du = defaultLineUnit(p.unitInfo, "SALE");
    setLines([...lines, { ...p, unitId: du.unitId, quantity: "1", unitPrice: scalePrice(p.price, du.factor), discountType: "FIXED", discountValue: "0" }]);
    setE((x) => ({ ...x, items: "" }));
  }
  const step = (l: Line, dir: 1 | -1) => {
    const cur = isQuantity(l.quantity) ? toUnits(l.quantity, 3) : BigInt(0);
    const next = cur + BigInt(dir) * BigInt(1000);
    if (next <= BigInt(0)) return;
    patch(l.productId, { quantity: formatQuantity(fromUnits(next, 3)).replace(/,/g, "") });
  };

  function lineProblem(l: Line): string {
    if (!isQuantity(l.quantity)) return F.problemQty;
    if (!okMoney(l.unitPrice)) return F.problemPrice;
    if (!okPct(l.taxRate)) return F.problemTax;
    if (l.discountType === "FIXED" ? !okMoney(l.discountValue) : !okPct(l.discountValue)) return l.discountType === "FIXED" ? F.problemDiscountAmount : F.problemDiscountPct;
    return "";
  }

  function save() {
    if (blocked) return;
    const n: Partial<Record<SaleField, string>> = {};
    const ie: Record<string, string> = {};
    if (!date) n.saleDate = S.val.dateRequired;
    else if (date > today) n.saleDate = S.val.dateFuture;
    if (!warehouseId) n.warehouseId = S.val.chooseWarehouse;
    if (!customerId) n.customerId = S.val.chooseCustomer;
    if (!lines.length) n.items = S.val.addItem;
    lines.forEach((l, i) => {
      const p = lineProblem(l) || (calc.lines[i]?.errorKey ? tr(T, calc.lines[i].errorKey!) : calc.lines[i]?.error) || "";
      if (p) ie[l.productId] = p;
    });
    if (status === "COMPLETED" && warehouseId) {
      for (const l of lines) {
        if (ie[l.productId] || !isQuantity(l.quantity)) continue;
        const have = onHand.get(l.productId) ?? "0.000";
        // Stock is counted in BASE units: the line's quantity is converted with the unit's factor first.
        if (baseUnits(l.quantity, findLineUnit(l.unitInfo, l.unitId).factor) > toUnits(have, 3)) ie[l.productId] = fmt(F.onlyInStock, { qty: formatQuantity(have), unit: l.unitInfo.baseUnit });
      }
    }
    if (Object.keys(ie).length) n.items ??= Object.values(ie)[0];
    if (!okPct(orderTaxRate)) n.orderTaxRate = F.orderTaxPct;
    if (!okMoney(discount)) n.discount = F.discountAmount;
    if (!okMoney(shipping)) n.shipping = F.shippingAmount;
    if (!n.discount && calc.error && !Object.keys(ie).length) n.discount = calc.errorKey ? tr(T, calc.errorKey) : calc.error;
    setE(n);
    setItemErr(ie);
    if (Object.keys(n).length) return void toast.error(Object.values(n)[0]!, { id: "sale" });
    // Inputs only — the server recomputes every amount and owns status, reference and currency.
    const payload = {
      saleDate: date,
      warehouseId,
      customerId,
      status,
      orderTaxRate: orderTaxRate.trim(),
      discount: discount.trim(),
      shipping: shipping.trim(),
      notes,
      items: lines.map((l) => ({ productId: l.productId, unitId: l.unitId, quantity: l.quantity.trim(), unitPrice: l.unitPrice.trim(), taxType: l.taxType, taxRate: l.taxRate.trim(), discountType: l.discountType, discountValue: l.discountValue.trim() })),
    };
    startTransition(async () => {
      let r: SaleResult;
      try {
        r = draft ? await updateSale(draft.id, payload) : await createSale(payload);
      } catch {
        return void toast.error(T.common.somethingWrong, { id: "sale" });
      }
      if (!r.ok) {
        if (r.fieldErrors) setE(r.fieldErrors);
        if (r.itemErrors) setItemErr(r.itemErrors);
        return void toast.error(r.message, { id: "sale", duration: 6000 });
      }
      toast.success(r.message, { id: "sale", duration: 6000 });
      router.push(r.id ? `/sales/${encodeURIComponent(r.id)}` : "/sales");
      router.refresh();
    });
  }

  const field = (k: SaleField | "status", label: string, child: ReactNode, required = false, style?: CSSProperties, hint?: ReactNode) => (
    <div className={"sp-field" + (e[k as SaleField] ? " sp-field--error" : "")} style={style}>
      <label className="sp-label" htmlFor={`sa-${k}`}>
        {label}
        {required && <i>*</i>}
      </label>
      {child}
      {e[k as SaleField] ? <span className="sp-error" id={`sa-${k}-error`}>{e[k as SaleField]}</span> : hint ? <span className="sp-hint">{hint}</span> : null}
    </div>
  );
  const sel = (k: SaleField, value: string, onChange: (v: string) => void, placeholder: string, opts: SaleOption[]) => (
    <select id={`sa-${k}`} className={"sp-select " + (value ? "" : "sp-select--placeholder")} value={value} disabled={!opts.length} onChange={(ev) => { onChange(ev.target.value); setE((x) => ({ ...x, [k]: "" })); }} aria-invalid={!!e[k] || undefined}>
      <option value="" disabled>
        {opts.length ? placeholder : F.noneYet}
      </option>
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
  const addonInput = (k: SaleField, value: string, set: (v: string) => void, addon: string) => (
    <div className="sp-group">
      <input id={`sa-${k}`} className="sp-input " inputMode="decimal" value={value} onChange={(ev) => { set(ev.target.value); setE((x) => ({ ...x, [k]: "" })); }} aria-invalid={!!e[k] || undefined} />
      <span className="sp-addon sp-addon--r">{addon}</span>
    </div>
  );
  const symbol = currency?.symbol ?? "—";

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {editing ? fmt(F.editTitle, { ref: draft.reference }) : F.createTitle}
        </h1>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href={back} className="sp-btn sp-btn--secondary">
            <Icon name="arrow-left" size={18} />
            {F.back}
          </Link>
        </div>
      </div>

      {blocked && (
        <div className="sp-badge sp-badge--warning" role="status" data-testid="sale-setup" style={{ height: "auto", padding: "10px 14px", whiteSpace: "normal", marginBottom: 16 }}>
          <Icon name="info" size={16} />
          <span>
            {F.setupBefore}{" "}
            {missing.map((m, i) => (
              <Fragment key={m.key}>
                {i > 0 && (i === missing.length - 1 ? F.setupAnd : F.setupSep)}
                <span data-missing={m.key}>{m.text}</span>
              </Fragment>
            ))}
            .
          </span>
        </div>
      )}

      <form noValidate aria-busy={pending} onSubmit={(ev) => { ev.preventDefault(); save(); }}>
        <div className="sp-card sp-form-card">
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div className="sp-form-grid" style={{ "--cols": 3 } as CSSProperties}>
              {field("saleDate", F.date, <input id="sa-saleDate" type="date" className="sp-input " max={today} value={date} onChange={(ev) => { setDate(ev.target.value); setE((x) => ({ ...x, saleDate: "" })); }} aria-invalid={!!e.saleDate || undefined} />, true)}
              {field("warehouseId", F.warehouse, sel("warehouseId", warehouseId, setWarehouseId, F.chooseWarehouse, warehouses), true)}
              {field("customerId", F.customer, sel("customerId", customerId, setCustomerId, F.chooseCustomer, customers), true)}
            </div>

            <div className="sp-field">
              <label className="sp-label" htmlFor="sa-product">
                {F.product}
              </label>
              <div style={{ position: "relative" }}>
                <div className="sp-group">
                  <Icon name="search" size={18} className="sp-input-icon" />
                  <input
                    id="sa-product"
                    className="sp-input "
                    placeholder={F.productSearch}
                    value={q}
                    autoComplete="off"
                    disabled={!products.length}
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
                      suggestions.map((p) => (
                        <button key={p.productId} type="button" role="option" aria-selected={false} className="sp-menu-item" onMouseDown={() => add(p)}>
                          <span className="sp-code">{p.code}</span>
                          {p.name}
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
            </div>

            <div className={"sp-field" + (e.items ? " sp-field--error" : "")}>
              <span className="sp-label">
                {F.orderItems}<i>*</i>
              </span>
              <div className="sp-table-card" style={{ boxShadow: "none" }}>
                <div className="sp-table-scroll">
                  <table className="sp-table" data-testid="sale-items">
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
                            {F.noItems}
                          </td>
                        </tr>
                      )}
                      {lines.map((l, i) => {
                        const c = calc.lines[i];
                        return (
                          <tr key={l.productId} style={{ height: 80 }} data-product={l.code}>
                            <td style={{ padding: "12px 20px" }}>
                              <div style={{ fontWeight: 600, marginBottom: 4 }}>{l.code}</div>
                              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span className="sp-badge sp-badge--success">{l.name}</span>
                                <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={fmt(F.editItem, { name: l.name })} onClick={() => setEdit({ ...l })}>
                                  <Icon name="pencil" size={16} />
                                </button>
                              </span>
                              {itemErr[l.productId] && (
                                <div className="sp-error" style={{ marginTop: 6 }}>
                                  {itemErr[l.productId]}
                                </div>
                              )}
                            </td>
                            <td data-col="net">{money(c.netUnitCost)}</td>
                            <td>
                              <span className="sp-badge sp-badge--warning" title={F.stockTitle}>
                                {warehouseId ? `${formatQuantity(onHand.get(l.productId) ?? "0.000")} ${l.unitInfo.baseUnit}` : "—"}
                              </span>
                            </td>
                            <td>
                              <span className="sp-qty">
                                <button type="button" className="sp-btn sp-btn--secondary sp-btn--icon" aria-label={fmt(F.decrease, { name: l.name })} onClick={() => step(l, -1)}>
                                  <Icon name="minus" size={18} />
                                </button>
                                <input className="sp-input" aria-label={fmt(F.qtyOf, { name: l.name })} inputMode="decimal" value={l.quantity} onChange={(ev) => patch(l.productId, { quantity: ev.target.value })} />
                                <button type="button" className="sp-btn sp-btn--secondary sp-btn--icon" aria-label={fmt(F.increase, { name: l.name })} onClick={() => step(l, 1)}>
                                  <Icon name="plus" size={18} />
                                </button>
                              </span>
                              <span className="t-caption" style={{ display: "block" }}>{findLineUnit(l.unitInfo, l.unitId).name}</span>
                              <BaseHint info={l.unitInfo} unitId={l.unitId} qty={l.quantity} />
                            </td>
                            <td data-col="discount">{money(c.discountAmount)}</td>
                            <td data-col="tax">{money(c.taxAmount)}</td>
                            <td data-col="subtotal">{money(c.subtotal)}</td>
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

            <div className="sp-sum" data-testid="sale-summary">
              <div>
                <span>{F.orderTax}</span>
                <span data-testid="sum-tax">
                  {money(calc.orderTaxAmount)} ({okPct(orderTaxRate) ? Number(orderTaxRate).toFixed(2) : "0.00"}) %
                </span>
              </div>
              <div>
                <span>{F.discount}</span>
                <span data-testid="sum-discount">{money(okMoney(discount) ? discount.trim() : "0")}</span>
              </div>
              <div>
                <span>{F.shipping}</span>
                <span data-testid="sum-shipping">{money(okMoney(shipping) ? shipping.trim() : "0")}</span>
              </div>
              <div>
                <span>{F.grandTotal}</span>
                <span data-testid="sum-grand">{money(calc.grandTotal)}</span>
              </div>
            </div>

            <div className="sp-form-grid" style={{ "--cols": 3 } as CSSProperties}>
              {field("orderTaxRate", F.orderTax, addonInput("orderTaxRate", orderTaxRate, setOrderTaxRate, "%"))}
              {field("discount", F.discount, addonInput("discount", discount, setDiscount, symbol))}
              {field("shipping", F.shipping, addonInput("shipping", shipping, setShipping, symbol))}
            </div>

            <div className="sp-form-grid" style={{ "--cols": 3 } as CSSProperties}>
              {field(
                "status",
                F.status,
                <select id="sa-status" className="sp-select " value={status} onChange={(ev) => { setStatus(ev.target.value as SaleStatusValue); setItemErr({}); setE((x) => ({ ...x, status: "", items: "" })); }}>
                  {SALE_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {S.status[st]}
                    </option>
                  ))}
                </select>,
                true,
                undefined,
                status === "COMPLETED" ? F.statusCompletedHint : F.statusPendingHint,
              )}
              <div className="sp-field">
                <label className="sp-label" htmlFor="sa-paymentStatus">
                  {F.paymentStatus}<i>*</i>
                </label>
                <select id="sa-paymentStatus" className="sp-select " value="UNPAID" disabled>
                  <option value="UNPAID">{F.unpaid}</option>
                </select>
                <span className="sp-hint">{F.paymentHint}</span>
              </div>
            </div>

            {field("notes", F.notes, <textarea id="sa-notes" className="sp-textarea " rows={4} placeholder={F.notesPh} maxLength={2000} value={notes} onChange={(ev) => setNotes(ev.target.value)} />)}
            {draft?.quotationRef && <span className="t-caption">{fmt(F.fromQuotation, { ref: draft.quotationRef })}</span>}
          </div>
          <div className="sp-form-actions">
            <button type="button" className="sp-btn sp-btn--secondary" onClick={() => router.push(back)} disabled={pending}>
              {F.cancel}
            </button>
            <button type="submit" className="sp-btn sp-btn--primary" disabled={pending || blocked} title={blocked ? F.completeSetup : undefined}>
              {pending ? F.saving : F.save}
            </button>
          </div>
        </div>
      </form>

      {edit && (
        <Modal
          size="sm"
          title={edit.name}
          onClose={() => setEdit(null)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setEdit(null)}>
                {F.cancel}
              </button>
              <button
                type="button"
                className="sp-btn sp-btn--primary"
                onClick={() => {
                  const problem = lineProblem(edit);
                  if (problem) return void toast.error(problem, { id: "sale-item" });
                  patch(edit.productId, { unitId: edit.unitId, unitPrice: edit.unitPrice.trim(), taxType: edit.taxType, taxRate: edit.taxRate.trim(), discountType: edit.discountType, discountValue: edit.discountValue.trim() });
                  setEdit(null);
                }}
              >
                {F.save}
              </button>
            </>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }} data-testid="item-modal">
            <div className="sp-field">
              <label className="sp-label" htmlFor="si-price">
                {F.productPrice}<i>*</i>
              </label>
              <div className="sp-group">
                <input id="si-price" className="sp-input " inputMode="decimal" value={edit.unitPrice} onChange={(ev) => setEdit({ ...edit, unitPrice: ev.target.value })} />
                <span className="sp-addon sp-addon--r">{symbol}</span>
              </div>
              <span className="sp-hint">{F.priceHint}</span>
            </div>
            <div className="sp-field">
              <label className="sp-label" htmlFor="si-taxType">
                {F.taxType}<i>*</i>
              </label>
              <select id="si-taxType" className="sp-select " value={edit.taxType} onChange={(ev) => setEdit({ ...edit, taxType: ev.target.value as Line["taxType"] })}>
                <option value="INCLUSIVE">{F.inclusive}</option>
                <option value="EXCLUSIVE">{F.exclusive}</option>
              </select>
            </div>
            <div className="sp-field">
              <label className="sp-label" htmlFor="si-taxRate">
                {F.orderTax}
              </label>
              <div className="sp-group">
                <input id="si-taxRate" className="sp-input " inputMode="decimal" value={edit.taxRate} onChange={(ev) => setEdit({ ...edit, taxRate: ev.target.value })} />
                <span className="sp-addon sp-addon--r">%</span>
              </div>
            </div>
            <div className="sp-field">
              <label className="sp-label" htmlFor="si-discountType">
                {F.discountType}<i>*</i>
              </label>
              <select id="si-discountType" className="sp-select " value={edit.discountType} onChange={(ev) => setEdit({ ...edit, discountType: ev.target.value as Line["discountType"] })}>
                <option value="FIXED">{F.fixed}</option>
                <option value="PERCENTAGE">{F.percentage}</option>
              </select>
            </div>
            <div className="sp-field">
              <label className="sp-label" htmlFor="si-discountValue">
                {F.discount}<i>*</i>
              </label>
              <div className="sp-group">
                <input id="si-discountValue" className="sp-input " inputMode="decimal" value={edit.discountValue} onChange={(ev) => setEdit({ ...edit, discountValue: ev.target.value })} />
                <span className="sp-addon sp-addon--r">{edit.discountType === "FIXED" ? symbol : "%"}</span>
              </div>
            </div>
            <div className="sp-field">
              <label className="sp-label" htmlFor="si-unit">
                {F.saleUnit}<i>*</i>
              </label>
              <LineUnitSelect id="si-unit" info={edit.unitInfo} purpose="SALE" value={edit.unitId} onChange={(unitId) => setEdit({ ...edit, unitId, unitPrice: scalePrice(edit.price, findLineUnit(edit.unitInfo, unitId).factor) })} />
              <span className="sp-hint">{T.units.line.unitHint} {T.units.line.priceHint}</span>
            </div>
          </div>
        </Modal>
      )}

      {remove && (
        <ConfirmDeleteModal
          itemType={T.sales.form.product.toLowerCase() === "product" ? "product" : F.product}
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
