"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import Modal, { ConfirmDeleteModal } from "@/components/ui/Modal";
import { createPurchase, type PurchaseResult } from "@/app/(dashboard)/purchases/actions";
import { formatMoney, formatQuantity } from "@/lib/money";
import { fromUnits, isQuantity, toUnits } from "@/lib/transfers";
import { calcOrder, type LineInput } from "@/lib/purchase-calc";
import { PURCHASE_STATUS_LABEL, PURCHASE_STATUSES, type PurchaseField, type PurchaseOption, type PurchaseProduct, type PurchaseStatusValue, type PurchaseStockLevel } from "@/lib/purchases";

// Port of design/Create Purchase.html: PageHeader (+ Back), FormCard with Date / Warehouse /
// Supplier, product search, Order items table (Product + edit-item pencil / Net Unit Cost / Stock /
// Qty −/+ / Discount / Tax / Subtotal / remove), summary (Order Tax / Discount / Shipping / Grand
// Total), Order Tax / Discount / Shipping inputs, Status and Notes, plus the per-item modal
// (Product Cost, Tax Type, Tax, Discount Type, Discount, Purchase Unit). Totals shown here are a
// preview from the same calculation the server uses; the server recomputes everything on save.
// Line edits apply to this purchase only — they never change the product's own cost or tax.

type Line = PurchaseProduct & { quantity: string; unitCost: string; taxType: "EXCLUSIVE" | "INCLUSIVE"; taxRate: string; discountType: "FIXED" | "PERCENTAGE"; discountValue: string };
type Currency = { code: string; symbol: string; right: boolean } | null;
const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
const PCT_RE = /^\d{1,3}(\.\d{1,2})?$/;
const okMoney = (v: string) => MONEY_RE.test(v.trim());
const okPct = (v: string) => PCT_RE.test(v.trim()) && Number(v) <= 100;
/** Inputs safe for the live preview (invalid values count as 0 until fixed). */
const safe = (l: Line): LineInput => ({
  quantity: isQuantity(l.quantity) ? l.quantity.trim() : "0",
  unitCost: okMoney(l.unitCost) ? l.unitCost.trim() : "0",
  taxType: l.taxType,
  taxRate: okPct(l.taxRate) ? l.taxRate.trim() : "0",
  discountType: l.discountType,
  discountValue: (l.discountType === "FIXED" ? okMoney(l.discountValue) : okPct(l.discountValue)) ? l.discountValue.trim() : "0",
});

export default function PurchaseForm({
  suppliers,
  warehouses,
  products,
  stock,
  currency,
  today,
  canOpenSettings,
}: {
  suppliers: PurchaseOption[];
  warehouses: PurchaseOption[];
  products: PurchaseProduct[];
  stock: PurchaseStockLevel[];
  currency: Currency;
  today: string;
  canOpenSettings: boolean;
}) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [warehouseId, setWarehouseId] = useState(warehouses.length === 1 ? warehouses[0].value : "");
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [orderTaxRate, setOrderTaxRate] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [shipping, setShipping] = useState("0");
  const [status, setStatus] = useState<PurchaseStatusValue>("RECEIVED");
  const [notes, setNotes] = useState("");
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const [edit, setEdit] = useState<Line | null>(null);
  const [remove, setRemove] = useState<Line | null>(null);
  const [e, setE] = useState<Partial<Record<PurchaseField, string>>>({});
  const [itemErr, setItemErr] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const onHand = useMemo(() => new Map(stock.filter((s) => s.warehouseId === warehouseId).map((s) => [s.productId, s.quantity])), [stock, warehouseId]);
  const money = (v: string) => formatMoney(v, currency);

  const missing: { key: string; text: ReactNode }[] = [];
  if (!currency) missing.push({ key: "currency", text: canOpenSettings ? <>a default currency in <Link href="/settings">System Settings</Link></> : <>a default currency (ask the Owner to choose one in System Settings)</> });
  if (!warehouses.length) missing.push({ key: "warehouse", text: <>a <Link href="/warehouse/create">warehouse</Link></> });
  if (!suppliers.length) missing.push({ key: "supplier", text: <>a <Link href="/suppliers/create">supplier</Link></> });
  if (!products.length) missing.push({ key: "product", text: <>a <Link href="/products/create">product</Link></> });
  const blocked = missing.length > 0;

  const calc = calcOrder(lines.map(safe), { orderTaxRate: okPct(orderTaxRate) ? orderTaxRate.trim() : "0", discount: okMoney(discount) ? discount.trim() : "0", shipping: okMoney(shipping) ? shipping.trim() : "0" });
  const needle = q.trim().toLowerCase();
  const suggestions = needle ? products.filter((p) => (p.code + " " + p.name).toLowerCase().includes(needle)).slice(0, 20) : [];

  const patch = (productId: string, p: Partial<Line>) => {
    setLines((ls) => ls.map((l) => (l.productId === productId ? { ...l, ...p } : l)));
    setItemErr((x) => ({ ...x, [productId]: "" }));
    setE((x) => ({ ...x, items: "" }));
  };
  function add(p: PurchaseProduct) {
    setQ("");
    if (lines.some((l) => l.productId === p.productId)) return void toast(`${p.name} is already in the order items`, { id: "purchase", icon: "ℹ️" });
    setLines([...lines, { ...p, quantity: "1", unitCost: p.cost, taxType: p.taxType, taxRate: p.taxRate, discountType: "FIXED", discountValue: "0" }]);
    setE((x) => ({ ...x, items: "" }));
  }
  const step = (l: Line, dir: 1 | -1) => {
    const cur = isQuantity(l.quantity) ? toUnits(l.quantity, 3) : BigInt(0);
    const next = cur + BigInt(dir) * BigInt(1000);
    if (next <= BigInt(0)) return;
    patch(l.productId, { quantity: formatQuantity(fromUnits(next, 3)).replace(/,/g, "") });
  };

  function lineProblem(l: Line): string {
    if (!isQuantity(l.quantity)) return "Enter a quantity greater than 0 (up to 3 decimals)";
    if (!okMoney(l.unitCost)) return "Enter a valid product cost";
    if (!okPct(l.taxRate)) return "Tax must be a percentage between 0 and 100";
    if (l.discountType === "FIXED" ? !okMoney(l.discountValue) : !okPct(l.discountValue)) return l.discountType === "FIXED" ? "Enter a valid discount amount" : "Discount percentage must be between 0 and 100";
    return "";
  }

  function save() {
    if (blocked) return;
    const n: Partial<Record<PurchaseField, string>> = {};
    const ie: Record<string, string> = {};
    if (!date) n.purchaseDate = "Date is required";
    else if (date > today) n.purchaseDate = "The date can't be in the future";
    if (!warehouseId) n.warehouseId = "Choose a warehouse";
    if (!supplierId) n.supplierId = "Choose a supplier";
    if (!lines.length) n.items = "Add at least one order item";
    lines.forEach((l, i) => {
      const p = lineProblem(l) || calc.lines[i]?.error || "";
      if (p) ie[l.productId] = p;
    });
    if (Object.keys(ie).length) n.items ??= Object.values(ie)[0];
    if (!okPct(orderTaxRate)) n.orderTaxRate = "Order tax must be a percentage between 0 and 100";
    if (!okMoney(discount)) n.discount = "Enter a valid discount amount";
    if (!okMoney(shipping)) n.shipping = "Enter a valid shipping amount";
    if (!n.discount && calc.error && !Object.keys(ie).length) n.discount = calc.error;
    setE(n);
    setItemErr(ie);
    if (Object.keys(n).length) return void toast.error(Object.values(n)[0]!, { id: "purchase" });
    // Inputs only — the server recomputes every amount and total.
    const payload = {
      purchaseDate: date,
      warehouseId,
      supplierId,
      status,
      orderTaxRate: orderTaxRate.trim(),
      discount: discount.trim(),
      shipping: shipping.trim(),
      notes,
      items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity.trim(), unitCost: l.unitCost.trim(), taxType: l.taxType, taxRate: l.taxRate.trim(), discountType: l.discountType, discountValue: l.discountValue.trim() })),
    };
    startTransition(async () => {
      let r: PurchaseResult;
      try {
        r = await createPurchase(payload);
      } catch {
        return void toast.error("Something went wrong. Please try again.", { id: "purchase" });
      }
      if (!r.ok) {
        if (r.fieldErrors) setE(r.fieldErrors);
        if (r.itemErrors) setItemErr(r.itemErrors);
        return void toast.error(r.message, { id: "purchase" });
      }
      toast.success(r.message, { id: "purchase", duration: 6000 });
      router.push(r.id ? `/purchases/${encodeURIComponent(r.id)}` : "/purchases");
      router.refresh();
    });
  }

  const field = (k: PurchaseField, label: string, child: ReactNode, required = false, style?: CSSProperties, hint?: ReactNode) => (
    <div className={"sp-field" + (e[k] ? " sp-field--error" : "")} style={style}>
      <label className="sp-label" htmlFor={`pu-${k}`}>
        {label}
        {required && <i>*</i>}
      </label>
      {child}
      {e[k] ? <span className="sp-error" id={`pu-${k}-error`}>{e[k]}</span> : hint ? <span className="sp-hint">{hint}</span> : null}
    </div>
  );
  const sel = (k: PurchaseField, value: string, onChange: (v: string) => void, placeholder: string, opts: PurchaseOption[]) => (
    <select id={`pu-${k}`} className={"sp-select " + (value ? "" : "sp-select--placeholder")} value={value} disabled={!opts.length} onChange={(ev) => { onChange(ev.target.value); setE((x) => ({ ...x, [k]: "" })); }} aria-invalid={!!e[k] || undefined}>
      <option value="" disabled>
        {opts.length ? placeholder : "None available yet"}
      </option>
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
  const addonInput = (k: PurchaseField, value: string, set: (v: string) => void, addon: string) => (
    <div className="sp-group">
      <input id={`pu-${k}`} className="sp-input " inputMode="decimal" value={value} onChange={(ev) => { set(ev.target.value); setE((x) => ({ ...x, [k]: "" })); }} aria-invalid={!!e[k] || undefined} />
      <span className="sp-addon sp-addon--r">{addon}</span>
    </div>
  );
  const symbol = currency?.symbol ?? "—";

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          Create Purchase
        </h1>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/purchases" className="sp-btn sp-btn--secondary">
            <Icon name="arrow-left" size={18} />
            Back
          </Link>
        </div>
      </div>

      {blocked && (
        <div className="sp-badge sp-badge--warning" role="status" data-testid="purchase-setup" style={{ height: "auto", padding: "10px 14px", whiteSpace: "normal", marginBottom: 16 }}>
          <Icon name="info" size={16} />
          <span>
            Before recording a purchase, set up{" "}
            {missing.map((m, i) => (
              <Fragment key={m.key}>
                {i > 0 && (i === missing.length - 1 ? " and " : ", ")}
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
              {field("purchaseDate", "Date", <input id="pu-purchaseDate" type="date" className="sp-input " max={today} value={date} onChange={(ev) => { setDate(ev.target.value); setE((x) => ({ ...x, purchaseDate: "" })); }} aria-invalid={!!e.purchaseDate || undefined} />, true)}
              {field("warehouseId", "Warehouse", sel("warehouseId", warehouseId, setWarehouseId, "Choose Warehouse", warehouses), true)}
              {field("supplierId", "Supplier", sel("supplierId", supplierId, setSupplierId, "Choose Supplier", suppliers), true)}
            </div>

            <div className="sp-field">
              <label className="sp-label" htmlFor="pu-product">
                Product
              </label>
              <div style={{ position: "relative" }}>
                <div className="sp-group">
                  <Icon name="search" size={18} className="sp-input-icon" />
                  <input
                    id="pu-product"
                    className="sp-input "
                    placeholder="Search Product by Code Name"
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
                  <div className="sp-sug" role="listbox" aria-label="Products">
                    {suggestions.length ? (
                      suggestions.map((p) => (
                        <button key={p.productId} type="button" role="option" aria-selected={false} className="sp-menu-item" onMouseDown={() => add(p)}>
                          <span className="sp-code">{p.code}</span>
                          {p.name}
                        </button>
                      ))
                    ) : (
                      <div className="t-caption" style={{ padding: "8px 10px" }}>
                        No products match “{q.trim()}”.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className={"sp-field" + (e.items ? " sp-field--error" : "")}>
              <span className="sp-label">
                Order items<i>*</i>
              </span>
              <div className="sp-table-card" style={{ boxShadow: "none" }}>
                <div className="sp-table-scroll">
                  <table className="sp-table" data-testid="purchase-items">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Net Unit Cost</th>
                        <th>Stock</th>
                        <th>Qty</th>
                        <th>Discount</th>
                        <th>Tax</th>
                        <th>Subtotal</th>
                        <th className="act">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.length === 0 && (
                        <tr>
                          <td colSpan={8} style={{ color: "var(--text-3)" }}>
                            No order items
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
                                <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={`Edit item ${l.name}`} onClick={() => setEdit({ ...l })}>
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
                              <span className="sp-badge sp-badge--warning">{warehouseId ? `${formatQuantity(onHand.get(l.productId) ?? "0.000")} ${l.unit}` : "—"}</span>
                            </td>
                            <td>
                              <span className="sp-qty">
                                <button type="button" className="sp-btn sp-btn--secondary sp-btn--icon" aria-label={`Decrease ${l.name}`} onClick={() => step(l, -1)}>
                                  <Icon name="minus" size={18} />
                                </button>
                                <input className="sp-input" aria-label={`Quantity of ${l.name}`} inputMode="decimal" value={l.quantity} onChange={(ev) => patch(l.productId, { quantity: ev.target.value })} />
                                <button type="button" className="sp-btn sp-btn--secondary sp-btn--icon" aria-label={`Increase ${l.name}`} onClick={() => step(l, 1)}>
                                  <Icon name="plus" size={18} />
                                </button>
                              </span>
                            </td>
                            <td data-col="discount">{money(c.discountAmount)}</td>
                            <td data-col="tax">{money(c.taxAmount)}</td>
                            <td data-col="subtotal">{money(c.subtotal)}</td>
                            <td className="act">
                              <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={`Remove ${l.name}`} style={{ color: "var(--danger-500)" }} onClick={() => setRemove(l)}>
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

            <div className="sp-sum" data-testid="purchase-summary">
              <div>
                <span>Order Tax</span>
                <span data-testid="sum-tax">
                  {money(calc.orderTaxAmount)} ({okPct(orderTaxRate) ? Number(orderTaxRate).toFixed(2) : "0.00"}) %
                </span>
              </div>
              <div>
                <span>Discount</span>
                <span data-testid="sum-discount">{money(okMoney(discount) ? discount.trim() : "0")}</span>
              </div>
              <div>
                <span>Shipping</span>
                <span data-testid="sum-shipping">{money(okMoney(shipping) ? shipping.trim() : "0")}</span>
              </div>
              <div>
                <span>Grand Total</span>
                <span data-testid="sum-grand">{money(calc.grandTotal)}</span>
              </div>
            </div>

            <div className="sp-form-grid" style={{ "--cols": 3 } as CSSProperties}>
              {field("orderTaxRate", "Order Tax", addonInput("orderTaxRate", orderTaxRate, setOrderTaxRate, "%"))}
              {field("discount", "Discount", addonInput("discount", discount, setDiscount, symbol))}
              {field("shipping", "Shipping", addonInput("shipping", shipping, setShipping, symbol))}
            </div>

            {field(
              "status",
              "Status",
              <select id="pu-status" className="sp-select " value={status} onChange={(ev) => setStatus(ev.target.value as PurchaseStatusValue)}>
                {PURCHASE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PURCHASE_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>,
              true,
              { width: "33%", minWidth: 260 },
              status === "RECEIVED" ? "Received adds the quantities to the warehouse stock now." : "Pending / Ordered record the purchase only — stock is added when it is marked as received.",
            )}

            {field("notes", "Notes", <textarea id="pu-notes" className="sp-textarea " rows={4} placeholder="Enter Notes" maxLength={2000} value={notes} onChange={(ev) => setNotes(ev.target.value)} />)}
            <span className="t-caption">Purchases are recorded as Unpaid. Supplier payments will be added in a later step.</span>
          </div>
          <div className="sp-form-actions">
            <button type="button" className="sp-btn sp-btn--secondary" onClick={() => router.push("/purchases")} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="sp-btn sp-btn--primary" disabled={pending || blocked} title={blocked ? "Complete the setup above first" : undefined}>
              {pending ? "Saving…" : "Save"}
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
                Cancel
              </button>
              <button
                type="button"
                className="sp-btn sp-btn--primary"
                onClick={() => {
                  const problem = lineProblem(edit);
                  if (problem) return void toast.error(problem, { id: "purchase-item" });
                  patch(edit.productId, { unitCost: edit.unitCost.trim(), taxType: edit.taxType, taxRate: edit.taxRate.trim(), discountType: edit.discountType, discountValue: edit.discountValue.trim() });
                  setEdit(null);
                }}
              >
                Save
              </button>
            </>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }} data-testid="item-modal">
            <div className="sp-field">
              <label className="sp-label" htmlFor="pi-cost">
                Product Cost<i>*</i>
              </label>
              <div className="sp-group">
                <input id="pi-cost" className="sp-input " inputMode="decimal" value={edit.unitCost} onChange={(ev) => setEdit({ ...edit, unitCost: ev.target.value })} />
                <span className="sp-addon sp-addon--r">{symbol}</span>
              </div>
              <span className="sp-hint">For this purchase only — the product&apos;s own cost is not changed.</span>
            </div>
            <div className="sp-field">
              <label className="sp-label" htmlFor="pi-taxType">
                Tax Type<i>*</i>
              </label>
              <select id="pi-taxType" className="sp-select " value={edit.taxType} onChange={(ev) => setEdit({ ...edit, taxType: ev.target.value as Line["taxType"] })}>
                <option value="INCLUSIVE">Inclusive</option>
                <option value="EXCLUSIVE">Exclusive</option>
              </select>
            </div>
            <div className="sp-field">
              <label className="sp-label" htmlFor="pi-taxRate">
                Order Tax
              </label>
              <div className="sp-group">
                <input id="pi-taxRate" className="sp-input " inputMode="decimal" value={edit.taxRate} onChange={(ev) => setEdit({ ...edit, taxRate: ev.target.value })} />
                <span className="sp-addon sp-addon--r">%</span>
              </div>
            </div>
            <div className="sp-field">
              <label className="sp-label" htmlFor="pi-discountType">
                Discount Type<i>*</i>
              </label>
              <select id="pi-discountType" className="sp-select " value={edit.discountType} onChange={(ev) => setEdit({ ...edit, discountType: ev.target.value as Line["discountType"] })}>
                <option value="FIXED">Fixed</option>
                <option value="PERCENTAGE">Percentage</option>
              </select>
            </div>
            <div className="sp-field">
              <label className="sp-label" htmlFor="pi-discountValue">
                Discount<i>*</i>
              </label>
              <div className="sp-group">
                <input id="pi-discountValue" className="sp-input " inputMode="decimal" value={edit.discountValue} onChange={(ev) => setEdit({ ...edit, discountValue: ev.target.value })} />
                <span className="sp-addon sp-addon--r">{edit.discountType === "FIXED" ? symbol : "%"}</span>
              </div>
            </div>
            <div className="sp-field">
              <label className="sp-label" htmlFor="pi-unit">
                Purchase Unit<i>*</i>
              </label>
              <select id="pi-unit" className="sp-select " value="unit" disabled>
                <option value="unit">{edit.unit}</option>
              </select>
              <span className="sp-hint">The product&apos;s purchase unit (unit conversion isn&apos;t available yet).</span>
            </div>
          </div>
        </Modal>
      )}

      {remove && (
        <ConfirmDeleteModal
          itemType="product"
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
