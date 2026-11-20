"use client";

import Link from "next/link";
import { useMemo, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { ConfirmDeleteModal } from "@/components/ui/Modal";
import { createTransfer, updateTransfer, type TransferResult } from "@/app/(dashboard)/transfers/actions";
import { formatMoney, formatQuantity } from "@/lib/money";
import {
  TRANSFER_STATUS_OPTIONS,
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
type Line = { productId: string; code: string; name: string; unit: string; cost: string; quantity: string };

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
  const editing = !!transferId;
  const [date, setDate] = useState(initial?.transferDate ?? today);
  const [from, setFrom] = useState(initial?.fromWarehouseId ?? "");
  const [to, setTo] = useState(initial?.toWarehouseId ?? "");
  const [status, setStatus] = useState<TransferStatusValue>(initial?.status ?? "PENDING");
  const [note, setNote] = useState(initial?.note ?? "");
  const [lines, setLines] = useState<Line[]>(() =>
    (initial?.items ?? []).flatMap((i) => {
      const p = initialLines.find((l) => l.productId === i.productId);
      return p ? [{ ...p, quantity: i.quantity }] : [];
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
            At least two warehouses are needed
          </h2>
          <p className="t-body" style={{ margin: "0 0 20px", color: "var(--text-2)" }}>
            A transfer moves stock from one warehouse to another.{" "}
            {warehouses.length === 0 ? "No warehouses exist yet." : "Only one warehouse exists so far."} Add another warehouse to start transferring stock.
          </p>
          <Link href="/warehouse" className="sp-btn sp-btn--primary">
            <Icon name="warehouse" size={18} />
            Go to Warehouse
          </Link>
        </div>
      </>
    );
  }

  const needle = q.trim().toLowerCase();
  const suggestions = from && needle
    ? [...available.values()].filter((s) => (s.code + " " + s.name).toLowerCase().includes(needle)).slice(0, 20)
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
      toast(`${s.name} is already in the order items`, { id: "transfer", icon: "ℹ️" });
      return;
    }
    setLines([...lines, { productId: s.productId, code: s.code, name: s.name, unit: s.unit, cost: s.cost, quantity: "1" }]);
    clearErr("items");
  }

  function changeFrom(v: string) {
    setFrom(v);
    clearErr("fromWarehouseId");
    if (v === to) setE((x) => ({ ...x, toWarehouseId: "From and To warehouses must be different" }));
    else clearErr("toWarehouseId");
    // Stock differs per warehouse — the items must be picked again from the new source.
    if (lines.length) {
      setLines([]);
      setItemErr({});
      toast("Source warehouse changed — order items were cleared.", { id: "transfer", icon: "ℹ️" });
    }
  }

  const step = (l: Line, dir: 1 | -1) => {
    const cur = isQuantity(l.quantity) ? toUnits(l.quantity, 3) : BigInt(0);
    const max = toUnits(availableOf(l.productId), 3);
    let next = cur + BigInt(dir) * BigInt(1000);
    if (dir === -1 && next <= BigInt(0)) return; // quantity must stay above 0
    if (dir === 1 && next > max) {
      next = max;
      toast.error(`Only ${formatQuantity(availableOf(l.productId))} ${l.unit} available`, { id: "transfer" });
      if (next === cur) return;
    }
    setQty(l.productId, formatQuantity(fromUnits(next, 3)).replace(/,/g, ""));
  };

  function save() {
    const n: Partial<Record<TransferField, string>> = {};
    const ie: Record<string, string> = {};
    if (!date) n.transferDate = "Date is required";
    if (!from) n.fromWarehouseId = "From Warehouse is required";
    if (!to) n.toWarehouseId = "To Warehouse is required";
    else if (from && from === to) n.toWarehouseId = "From and To warehouses must be different";
    if (!lines.length) n.items = "Add at least one order item";
    for (const l of lines) {
      if (!isQuantity(l.quantity)) ie[l.productId] = "Enter a quantity greater than 0 (up to 3 decimals)";
      else if (toUnits(l.quantity, 3) > toUnits(availableOf(l.productId), 3)) ie[l.productId] = `Only ${formatQuantity(availableOf(l.productId))} available`;
    }
    if (Object.keys(ie).length) n.items ??= Object.values(ie)[0];
    setE(n);
    setItemErr(ie);
    if (Object.keys(n).length) {
      toast.error(Object.values(n)[0]!, { id: "transfer" });
      return;
    }
    // Only ids, quantities, date, status and note are sent — never cost or stock.
    const payload = { transferDate: date, fromWarehouseId: from, toWarehouseId: to, status, note, items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity.trim() })) };
    startTransition(async () => {
      let r: TransferResult;
      try {
        r = editing ? await updateTransfer(transferId, payload) : await createTransfer(payload);
      } catch {
        toast.error("Something went wrong. Please try again.", { id: "transfer" });
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
  const totalQty = fromUnits(lines.reduce((a, l) => a + (isQuantity(l.quantity) ? toUnits(l.quantity, 3) : BigInt(0)), BigInt(0)), 3);
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
    <select id={`tr-${k}`} className={"sp-select " + (value ? "" : "sp-select--placeholder")} value={value} onChange={(ev) => onChange(ev.target.value)} aria-invalid={!!e[k] || undefined}>
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
            No default currency is configured, so costs are shown without a currency symbol. The Owner can choose one in <Link href="/settings">System Settings</Link>.
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
              {field("transferDate", "Date", true, (
                <input id="tr-transferDate" type="date" className="sp-input " value={date} onChange={(ev) => { setDate(ev.target.value); clearErr("transferDate"); }} aria-invalid={!!e.transferDate || undefined} />
              ))}
              {field("fromWarehouseId", "From Warehouse", true, whSelect("fromWarehouseId", from, changeFrom, "Choose From Warehouse"))}
              {field("toWarehouseId", "To Warehouse", true, whSelect("toWarehouseId", to, (v) => {
                setTo(v);
                setE((x) => ({ ...x, toWarehouseId: v && v === from ? "From and To warehouses must be different" : "" }));
              }, "Choose To Warehouse"))}
            </div>

            <div className="sp-field">
              <label className="sp-label" htmlFor="tr-product">
                Product
              </label>
              <div style={{ position: "relative" }}>
                <div className="sp-group">
                  <Icon name="search" size={18} className="sp-input-icon" />
                  <input
                    id="tr-product"
                    className="sp-input "
                    placeholder={from ? "Search Product by Code Name" : "Choose From Warehouse first"}
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
                  <div className="sp-sug" role="listbox" aria-label="Products">
                    {suggestions.length ? (
                      suggestions.map((s) => (
                        <button key={s.productId} type="button" role="option" aria-selected={false} className="sp-menu-item" onMouseDown={() => add(s)}>
                          <span className="sp-code">{s.code}</span>
                          {s.name}
                          <span style={{ marginLeft: "auto", color: "var(--text-3)", fontWeight: 400 }}>
                            {formatQuantity(s.available)} {s.unit}
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="t-caption" style={{ padding: "8px 10px" }}>
                        No products with stock in this warehouse match “{q.trim()}”.
                      </div>
                    )}
                  </div>
                )}
              </div>
              {from && available.size === 0 && <span className="sp-hint">This warehouse has no products in stock to transfer.</span>}
            </div>

            <div className={"sp-field" + (e.items ? " sp-field--error" : "")}>
              <span className="sp-label">
                Order items<i>*</i>
              </span>
              <div className="sp-table-card" style={{ boxShadow: "none" }}>
                <div className="sp-table-scroll">
                  <table className="sp-table" data-testid="transfer-items">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Net Unit Cost</th>
                        <th>Stock</th>
                        <th>Qty</th>
                        <th>Subtotal</th>
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
                        <tr key={l.productId} style={{ height: 80 }} data-product={l.code}>
                          <td style={{ padding: "12px 20px" }}>
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>{l.code}</div>
                            <span className="sp-badge sp-badge--success">{l.name}</span>
                            {itemErr[l.productId] && (
                              <div className="sp-error" style={{ marginTop: 6 }}>
                                {itemErr[l.productId]}
                              </div>
                            )}
                          </td>
                          <td>{money(l.cost)}</td>
                          <td>
                            <span className="sp-badge sp-badge--warning">
                              {formatQuantity(availableOf(l.productId))} {l.unit}
                            </span>
                          </td>
                          <td>
                            <span className="sp-qty">
                              <button type="button" className="sp-btn sp-btn--secondary sp-btn--icon" aria-label={`Decrease ${l.name}`} onClick={() => step(l, -1)}>
                                <Icon name="minus" size={18} />
                              </button>
                              <input
                                className="sp-input"
                                aria-label={`Quantity of ${l.name}`}
                                inputMode="decimal"
                                value={l.quantity}
                                aria-invalid={!!itemErr[l.productId] || undefined}
                                onChange={(ev) => setQty(l.productId, ev.target.value)}
                              />
                              <button type="button" className="sp-btn sp-btn--secondary sp-btn--icon" aria-label={`Increase ${l.name}`} onClick={() => step(l, 1)}>
                                <Icon name="plus" size={18} />
                              </button>
                            </span>
                          </td>
                          <td>{isQuantity(l.quantity) ? money(fromUnits(lineTotalCents(l.quantity, l.cost), 2)) : "—"}</td>
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

            <div className="sp-sum" data-testid="transfer-summary">
              <div>
                <span>Items</span>
                <span>{lines.length}</span>
              </div>
              <div>
                <span>Total Quantity</span>
                <span>{formatQuantity(totalQty)}</span>
              </div>
              <div>
                <span>Grand Total</span>
                <span data-testid="transfer-total">{money(total)}</span>
              </div>
            </div>

            {field("status", "Status", true, (
              <>
                <select id="tr-status" className="sp-select " value={status} onChange={(ev) => { setStatus(ev.target.value as TransferStatusValue); clearErr("status"); }}>
                  {TRANSFER_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span className="sp-hint">
                  {status === "PENDING" && "Pending records the transfer only — no stock moves yet."}
                  {status === "SENT" && "Sent deducts the quantities from the source warehouse now."}
                  {status === "COMPLETED" && "Completed moves the stock now: deducted from the source and added to the destination. Completed transfers can't be changed."}
                </span>
              </>
            ), { width: "33%", minWidth: 260 })}

            {field("note", "Note", false, (
              <textarea id="tr-note" className="sp-textarea " rows={4} placeholder="Enter Note" value={note} maxLength={2000} onChange={(ev) => setNote(ev.target.value)} />
            ))}
          </div>
          <div className="sp-form-actions">
            <button type="button" className="sp-btn sp-btn--secondary" onClick={() => router.push(editing ? `/transfers/${encodeURIComponent(transferId)}` : "/transfers")} disabled={pending}>
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
        {editing ? `Edit Transfer${reference ? ` ${reference}` : ""}` : "Create Transfer"}
      </h1>
      <div style={{ display: "flex", gap: 12 }}>
        <Link href="/transfers" className="sp-btn sp-btn--secondary">
          <Icon name="arrow-left" size={18} />
          Back
        </Link>
      </div>
    </div>
  );
}
