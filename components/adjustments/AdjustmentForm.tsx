"use client";

import Link from "next/link";
import { useMemo, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { ConfirmDeleteModal } from "@/components/ui/Modal";
import { createAdjustment, updateAdjustment, type AdjustmentResult } from "@/app/(dashboard)/adjustments/actions";
import { formatQuantity } from "@/lib/money";
import { fromUnits, isQuantity, toUnits, type WarehouseOption } from "@/lib/transfers";
import {
  ADJUSTMENT_TYPES,
  TYPE_LABEL,
  signedUnits,
  type AdjustmentField,
  type AdjustmentFormValues,
  type AdjustmentTypeValue,
  type ProductPick,
  type StockLevel,
} from "@/lib/adjustments";

// Port of design/Create Adjustment.html: PageHeader (+ Back), FormCard with Warehouse and Date,
// product search (suggestions), Order items table (Product / Code Product / Stock / Qty −/+ /
// Type / remove) and Save / Cancel. Products come from MySQL; Stock is the current on-hand
// quantity in the selected warehouse. The server re-validates everything on save.

type Line = ProductPick & { quantity: string; type: AdjustmentTypeValue };

export default function AdjustmentForm({
  warehouses,
  products,
  stock,
  today,
  adjustmentId,
  reference,
  initial,
}: {
  warehouses: WarehouseOption[];
  products: ProductPick[];
  stock: StockLevel[];
  today: string;
  adjustmentId?: string;
  reference?: string;
  initial?: AdjustmentFormValues;
}) {
  const router = useRouter();
  const editing = !!adjustmentId;
  const byId = useMemo(() => new Map(products.map((p) => [p.productId, p])), [products]);
  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId ?? (warehouses.length === 1 ? warehouses[0].value : ""));
  const [date, setDate] = useState(initial?.adjustmentDate ?? today);
  const [lines, setLines] = useState<Line[]>(() =>
    (initial?.items ?? []).flatMap((i) => {
      const p = byId.get(i.productId);
      return p ? [{ ...p, quantity: i.quantity, type: i.type }] : [];
    }),
  );
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const [remove, setRemove] = useState<Line | null>(null);
  const [e, setE] = useState<Partial<Record<AdjustmentField, string>>>({});
  const [itemErr, setItemErr] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const onHand = useMemo(() => new Map(stock.filter((s) => s.warehouseId === warehouseId).map((s) => [s.productId, s.quantity])), [stock, warehouseId]);
  const stockOf = (productId: string) => onHand.get(productId) ?? "0.000";
  /** Stock as it would be without this adjustment's saved effect (editing: already applied). */
  const baseOf = (productId: string) => {
    let units = toUnits(stockOf(productId), 3);
    if (initial && initial.warehouseId === warehouseId) {
      const orig = initial.items.find((i) => i.productId === productId);
      if (orig) units -= signedUnits(orig.quantity, orig.type);
    }
    return units;
  };

  if (warehouses.length === 0 || products.length === 0) {
    const noWh = warehouses.length === 0;
    return (
      <>
        <Header editing={editing} reference={reference} />
        <div className="sp-card" style={{ padding: "48px 24px", textAlign: "center" }} data-testid="adjustment-prerequisite">
          <span style={{ display: "inline-grid", placeItems: "center", width: 56, height: 56, borderRadius: "50%", background: "var(--primary-50)", color: "var(--primary-700)", marginBottom: 16 }}>
            <Icon name={noWh ? "warehouse" : "package"} size={26} />
          </span>
          <h2 className="t-section-title" style={{ margin: "0 0 8px" }}>
            {noWh ? "Add a warehouse first" : "Add a product first"}
          </h2>
          <p className="t-body" style={{ margin: "0 0 20px", color: "var(--text-2)" }}>
            {noWh ? "Stock adjustments are recorded per warehouse, and no warehouses exist yet." : "There are no products to adjust yet."}
          </p>
          <Link href={noWh ? "/warehouse/create" : "/products/create"} className="sp-btn sp-btn--primary">
            <Icon name="plus" size={18} />
            {noWh ? "Create Warehouse" : "Create Product"}
          </Link>
        </div>
      </>
    );
  }

  const needle = q.trim().toLowerCase();
  const suggestions = needle ? products.filter((p) => (p.code + " " + p.name).toLowerCase().includes(needle)).slice(0, 20) : [];
  const clearErr = (k: AdjustmentField) => setE((x) => ({ ...x, [k]: "" }));
  const patch = (productId: string, p: Partial<Line>) => {
    setLines((ls) => ls.map((l) => (l.productId === productId ? { ...l, ...p } : l)));
    setItemErr((x) => ({ ...x, [productId]: "" }));
    clearErr("items");
  };

  function add(p: ProductPick) {
    setQ("");
    if (lines.some((l) => l.productId === p.productId)) {
      toast(`${p.name} is already in the order items`, { id: "adjustment", icon: "ℹ️" });
      return;
    }
    setLines([...lines, { ...p, quantity: "1", type: "ADDITION" }]);
    clearErr("items");
  }

  const step = (l: Line, dir: 1 | -1) => {
    const cur = isQuantity(l.quantity) ? toUnits(l.quantity, 3) : BigInt(0);
    const next = cur + BigInt(dir) * BigInt(1000);
    if (next <= BigInt(0)) return; // quantity must stay above 0
    patch(l.productId, { quantity: formatQuantity(fromUnits(next, 3)).replace(/,/g, "") });
  };

  /**
   * Problem with a line given the selected warehouse's stock: the resulting stock can't go below 0
   * (a subtraction above stock, or — when editing — reducing an addition whose stock was used).
   * Advisory only; the server enforces it atomically.
   */
  const lineProblem = (l: Line) => {
    if (!isQuantity(l.quantity)) return "Enter a quantity greater than 0 (up to 3 decimals)";
    const base = baseOf(l.productId);
    if (base + signedUnits(l.quantity, l.type) < BigInt(0)) {
      if (base < BigInt(0)) return `Stock already used — this can't be lower than ${formatQuantity(fromUnits(-base, 3))} as an Addition`;
      return `Only ${formatQuantity(fromUnits(base, 3))} available to subtract`;
    }
    return "";
  };

  function save() {
    const n: Partial<Record<AdjustmentField, string>> = {};
    const ie: Record<string, string> = {};
    if (!warehouseId) n.warehouseId = "Warehouse is required";
    if (!date) n.adjustmentDate = "Date is required";
    if (!lines.length) n.items = "Add at least one order item";
    if (warehouseId) for (const l of lines) { const p = lineProblem(l); if (p) ie[l.productId] = p; }
    if (Object.keys(ie).length) n.items ??= Object.values(ie)[0];
    setE(n);
    setItemErr(ie);
    if (Object.keys(n).length) {
      toast.error(Object.values(n)[0]!, { id: "adjustment" });
      return;
    }
    // Only ids, quantities, types and the date are sent — never stock values.
    const payload = { warehouseId, adjustmentDate: date, items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity.trim(), type: l.type })) };
    startTransition(async () => {
      let r: AdjustmentResult;
      try {
        r = editing ? await updateAdjustment(adjustmentId, payload) : await createAdjustment(payload);
      } catch {
        toast.error("Something went wrong. Please try again.", { id: "adjustment" });
        return;
      }
      if (!r.ok) {
        if (r.fieldErrors) setE(r.fieldErrors);
        if (r.itemErrors) setItemErr(r.itemErrors);
        toast.error(r.message, { id: "adjustment" });
        router.refresh(); // pick up current stock
        return;
      }
      toast.success(r.message, { id: "adjustment" });
      router.push("/adjustments");
      router.refresh();
    });
  }

  const field = (k: AdjustmentField, label: string, child: React.ReactNode) => (
    <div className={"sp-field" + (e[k] ? " sp-field--error" : "")}>
      <label className="sp-label" htmlFor={`ad-${k}`}>
        {label}
        <i>*</i>
      </label>
      {child}
      {e[k] && <span className="sp-error">{e[k]}</span>}
    </div>
  );

  return (
    <>
      <Header editing={editing} reference={reference} />
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
              {field("warehouseId", "Warehouse", (
                <select
                  id="ad-warehouseId"
                  className={"sp-select " + (warehouseId ? "" : "sp-select--placeholder")}
                  value={warehouseId}
                  onChange={(ev) => {
                    setWarehouseId(ev.target.value);
                    clearErr("warehouseId");
                    setItemErr({});
                  }}
                  aria-invalid={!!e.warehouseId || undefined}
                >
                  <option value="" disabled>
                    Choose Warehouse
                  </option>
                  {warehouses.map((w) => (
                    <option key={w.value} value={w.value}>
                      {w.label}
                    </option>
                  ))}
                </select>
              ))}
              {field("adjustmentDate", "Date", (
                <input id="ad-adjustmentDate" type="date" className="sp-input " value={date} onChange={(ev) => { setDate(ev.target.value); clearErr("adjustmentDate"); }} aria-invalid={!!e.adjustmentDate || undefined} />
              ))}
            </div>

            <div className="sp-field">
              <label className="sp-label" htmlFor="ad-product">
                Product
              </label>
              <div style={{ position: "relative" }}>
                <div className="sp-group">
                  <Icon name="search" size={18} className="sp-input-icon" />
                  <input
                    id="ad-product"
                    className="sp-input "
                    placeholder="Search Product by Code Name"
                    value={q}
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
                  <div className="sp-sug" role="listbox" aria-label="Products">
                    {suggestions.length ? (
                      suggestions.map((p) => (
                        <button key={p.productId} type="button" role="option" aria-selected={false} className="sp-menu-item" onMouseDown={() => add(p)}>
                          <span className="sp-code">{p.code}</span>
                          {p.name}
                          {warehouseId && (
                            <span style={{ marginLeft: "auto", color: "var(--text-3)", fontWeight: 400 }}>
                              {formatQuantity(stockOf(p.productId))} {p.unit}
                            </span>
                          )}
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
                  <table className="sp-table" data-testid="adjustment-items">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Code Product</th>
                        <th>Stock</th>
                        <th>Qty</th>
                        <th>Type</th>
                        <th className="act">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.length === 0 && (
                        <tr>
                          <td colSpan={6} style={{ color: "var(--text-3)" }}>
                            No order items
                          </td>
                        </tr>
                      )}
                      {lines.map((l) => (
                        <tr key={l.productId} data-product={l.code}>
                          <td className="primary-cell">
                            {l.name}
                            {itemErr[l.productId] && (
                              <div className="sp-error" style={{ marginTop: 6, fontWeight: 400 }}>
                                {itemErr[l.productId]}
                              </div>
                            )}
                          </td>
                          <td>
                            <span className="sp-code">{l.code}</span>
                          </td>
                          <td>
                            <span className="sp-badge sp-badge--warning" data-testid="stock">
                              {warehouseId ? `${formatQuantity(stockOf(l.productId))} ${l.unit}` : "—"}
                            </span>
                          </td>
                          <td>
                            <span className="sp-qty">
                              <button type="button" className="sp-btn sp-btn--secondary sp-btn--icon" aria-label={`Decrease ${l.name}`} onClick={() => step(l, -1)}>
                                <Icon name="minus" size={18} />
                              </button>
                              <input className="sp-input" aria-label={`Quantity of ${l.name}`} inputMode="decimal" value={l.quantity} aria-invalid={!!itemErr[l.productId] || undefined} onChange={(ev) => patch(l.productId, { quantity: ev.target.value })} />
                              <button type="button" className="sp-btn sp-btn--secondary sp-btn--icon" aria-label={`Increase ${l.name}`} onClick={() => step(l, 1)}>
                                <Icon name="plus" size={18} />
                              </button>
                            </span>
                          </td>
                          <td style={{ width: 260 }}>
                            <select className="sp-select " aria-label={`Type of ${l.name}`} value={l.type} onChange={(ev) => patch(l.productId, { type: ev.target.value as AdjustmentTypeValue })}>
                              {ADJUSTMENT_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {TYPE_LABEL[t]}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="act">
                            <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={`Remove ${l.name}`} style={{ color: "var(--danger-500)" }} onClick={() => setRemove(l)}>
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
          </div>
          <div className="sp-form-actions">
            <button type="button" className="sp-btn sp-btn--secondary" onClick={() => router.push("/adjustments")} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="sp-btn sp-btn--primary" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>

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

function Header({ editing, reference }: { editing: boolean; reference?: string }) {
  return (
    <div className="sp-page-head">
      <h1 className="t-page-title" style={{ margin: 0 }}>
        {editing ? `Edit Adjustment${reference ? ` ${reference}` : ""}` : "Create Adjustment"}
      </h1>
      <div style={{ display: "flex", gap: 12 }}>
        <Link href="/adjustments" className="sp-btn sp-btn--secondary">
          <Icon name="arrow-left" size={18} />
          Back
        </Link>
      </div>
    </div>
  );
}
