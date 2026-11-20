"use client";

import Link from "next/link";
import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { ConfirmDeleteModal } from "@/components/ui/Modal";
import { createSaleReturn, type SaleReturnResult } from "@/app/(dashboard)/sales/returns/actions";
import { formatMoney, formatQuantity } from "@/lib/money";
import { fromUnits, isQuantity, toUnits } from "@/lib/transfers";
import { calcReturn } from "@/lib/purchase-return-calc";
import type { SaleReturnField, SaleReturnSourceLine, SaleReturnSource } from "@/lib/sale-returns";

// Port of design/Create Sale Return.html: PageHeader (+ Back), FormCard with Date / Warehouse /
// Customer, the Order items table (Product / Net Unit Price / Stock / Qty −/+ / Discount / Tax /
// Subtotal / remove), the summary (Order Tax / Discount / Shipping / Grand Total), Status and Notes.
// Adapted for a return of a real sale: the product search becomes the "Sale" picker (Completed
// sales only — the Edit Sale Return design shows this as "Sale Reference"); Warehouse and Customer
// come from that sale (read-only); lines are the sale's own lines; prices are the original snapshot
// (no item-edit modal, no order tax / discount / shipping inputs — those are shared out
// automatically, shipping isn't returned). Stock is shown for reference only (a return adds stock
// back). Totals here are a preview from the same calculation the server uses on save.

export default function SaleReturnForm({ sources, today, initialSale }: { sources: SaleReturnSource[]; today: string; initialSale: string }) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [saleId, setSaleId] = useState(initialSale);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [remove, setRemove] = useState<SaleReturnSourceLine | null>(null);
  const [e, setE] = useState<Partial<Record<SaleReturnField, string>>>({});
  const [itemErr, setItemErr] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const src = sources.find((s) => s.id === saleId) ?? null;
  const money = (v: string) => formatMoney(v, src?.currency ?? null);
  const returnable = (l: SaleReturnSourceLine) => fromUnits(toUnits(l.quantity, 3) - toUnits(l.returned, 3), 3);
  const lines = src ? src.lines.filter((l) => !removed.has(l.saleItemId) && toUnits(returnable(l), 3) > BigInt(0)) : [];
  const q = (id: string) => qty[id] ?? "0";
  const chosen = lines.filter((l) => isQuantity(q(l.saleItemId)));
  const calc = src
    ? calcReturn(
        { subtotal: src.subtotal, orderTaxAmount: src.orderTaxAmount, discount: src.discount, returnedSubtotal: src.returnedSubtotal },
        chosen.map((l) => ({ original: { quantity: l.quantity, subtotal: l.subtotal, taxAmount: l.taxAmount, discountAmount: l.discountAmount, returned: l.returned }, quantity: q(l.saleItemId) })),
      )
    : null;
  const lineCalc = (l: SaleReturnSourceLine) => (calc ? calc.lines[chosen.findIndex((c) => c.saleItemId === l.saleItemId)] : undefined);

  const pick = (id: string) => {
    setSaleId(id);
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
  const step = (l: SaleReturnSourceLine, dir: 1 | -1) => {
    const cur = isQuantity(q(l.saleItemId)) ? toUnits(q(l.saleItemId), 3) : BigInt(0);
    let next = cur + BigInt(dir) * BigInt(1000);
    const max = toUnits(returnable(l), 3);
    if (next < BigInt(0)) next = BigInt(0);
    if (next > max) {
      next = max;
      toast.error(`At most ${formatQuantity(fromUnits(max, 3))} ${l.unit} can be returned`, { id: "sale-return" });
    }
    setLine(l.saleItemId, formatQuantity(fromUnits(next, 3)).replace(/,/g, ""));
  };

  function problem(l: SaleReturnSourceLine): string {
    const v = q(l.saleItemId).trim();
    if (v === "" || v === "0") return "";
    if (!/^\d{1,11}(\.\d{1,3})?$/.test(v)) return "Enter a quantity with up to 3 decimals";
    if (toUnits(v, 3) > toUnits(returnable(l), 3)) return `Only ${formatQuantity(returnable(l))} can still be returned`;
    return "";
  }

  function save() {
    const n: Partial<Record<SaleReturnField, string>> = {};
    const ie: Record<string, string> = {};
    if (!src) n.saleId = "Choose a completed sale";
    if (!date) n.returnDate = "Date is required";
    else if (date > today) n.returnDate = "The date can't be in the future";
    else if (src && date < src.date) n.returnDate = `The return date can't be before the sale date (${src.dateLabel})`;
    for (const l of lines) {
      const p = problem(l);
      if (p) ie[l.saleItemId] = p;
    }
    const send = lines.filter((l) => isQuantity(q(l.saleItemId)) && !ie[l.saleItemId]);
    if (src && !Object.keys(ie).length && !send.length) n.items = "Enter a return quantity for at least one line";
    if (Object.keys(ie).length) n.items = Object.values(ie)[0];
    else if (src && calc && toUnits(calc.grandTotal, 2) > toUnits(src.due, 2)) n.items = `This return is worth ${money(calc.grandTotal)} but only ${money(src.due)} is still unpaid on ${src.reference}. Refunds and customer credit for paid amounts aren't available yet.`;
    setE(n);
    setItemErr(ie);
    if (Object.keys(n).length) return void toast.error(Object.values(n)[0]!, { id: "sale-return" });
    // Ids and quantities only — the server re-reads prices, stock and history.
    const payload = { returnDate: date, saleId, notes, items: send.map((l) => ({ saleItemId: l.saleItemId, quantity: q(l.saleItemId).trim() })) };
    startTransition(async () => {
      let r: SaleReturnResult;
      try {
        r = await createSaleReturn(payload);
      } catch {
        return void toast.error("Something went wrong. Please try again.", { id: "sale-return" });
      }
      if (!r.ok) {
        if (r.fieldErrors) setE(r.fieldErrors);
        if (r.itemErrors) setItemErr(r.itemErrors);
        toast.error(r.message, { id: "sale-return", duration: 7000 });
        router.refresh(); // current stock / returnable quantities
        return;
      }
      toast.success(r.message, { id: "sale-return", duration: 6000 });
      router.push(r.id ? `/sales/returns/${encodeURIComponent(r.id)}` : "/sales/returns");
      router.refresh();
    });
  }

  const field = (k: SaleReturnField | "warehouse" | "customer" | "status", label: string, child: ReactNode, required = false, style?: CSSProperties, hint?: ReactNode) => (
    <div className={"sp-field" + (e[k as SaleReturnField] ? " sp-field--error" : "")} style={style}>
      <label className="sp-label" htmlFor={`sr-${k}`}>
        {label}
        {required && <i>*</i>}
      </label>
      {child}
      {e[k as SaleReturnField] ? <span className="sp-error" id={`sr-${k}-error`}>{e[k as SaleReturnField]}</span> : hint ? <span className="sp-hint">{hint}</span> : null}
    </div>
  );

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          Create Sale Return
        </h1>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/sales/returns" className="sp-btn sp-btn--secondary">
            <Icon name="arrow-left" size={18} />
            Back
          </Link>
        </div>
      </div>

      {sources.length === 0 ? (
        <div className="sp-card sp-empty" data-testid="return-setup">
          <Icon name="receipt" size={36} />
          <div className="t-section-title">No completed sales to return</div>
          <span>A return must come from a Completed sale that still has items left to return and an unpaid balance (refunds for paid sales aren&apos;t available yet).</span>
          <Link href="/sales" className="sp-btn sp-btn--secondary">
            Go to Sales
          </Link>
        </div>
      ) : (
        <form noValidate aria-busy={pending} onSubmit={(ev) => { ev.preventDefault(); save(); }}>
          <div className="sp-card sp-form-card">
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <div className="sp-form-grid" style={{ "--cols": 3 } as CSSProperties}>
                {field("returnDate", "Date", <input id="sr-returnDate" type="date" className="sp-input " min={src?.date} max={today} value={date} onChange={(ev) => { setDate(ev.target.value); setE((x) => ({ ...x, returnDate: "" })); }} aria-invalid={!!e.returnDate || undefined} />, true)}
                {field("warehouse", "Warehouse", <select id="sr-warehouse" className="sp-select " disabled value="w"><option value="w">{src?.warehouse ?? "From the sale"}</option></select>, true)}
                {field("customer", "Customer", <select id="sr-customer" className="sp-select " disabled value="s"><option value="s">{src?.customer ?? "From the sale"}</option></select>, true)}
              </div>

              {field(
                "saleId",
                "Sale",
                <select id="sr-saleId" className={"sp-select " + (saleId ? "" : "sp-select--placeholder")} value={saleId} onChange={(ev) => pick(ev.target.value)} aria-invalid={!!e.saleId || undefined}>
                  <option value="" disabled>
                    Choose a Completed Sale
                  </option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.reference} · {s.customer} · {s.dateLabel}
                    </option>
                  ))}
                </select>,
                true,
                undefined,
                src ? `Still unpaid on ${src.reference}: ${money(src.due)} — a return can't exceed it (customer refunds/credit aren't available yet).` : "Only completed sales with items left to return and an unpaid balance are listed.",
              )}

              <div className={"sp-field" + (e.items ? " sp-field--error" : "")}>
                <span className="sp-label">
                  Order items<i>*</i>
                </span>
                <div className="sp-table-card" style={{ boxShadow: "none" }}>
                  <div className="sp-table-scroll">
                    <table className="sp-table" data-testid="return-items">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Net Unit Price</th>
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
                              {src ? "No order items" : "Choose a sale to load its items"}
                            </td>
                          </tr>
                        )}
                        {lines.map((l) => {
                          const c = lineCalc(l);
                          return (
                            <tr key={l.saleItemId} style={{ height: 80 }} data-product={l.code}>
                              <td style={{ padding: "12px 20px" }}>
                                <div style={{ fontWeight: 600, marginBottom: 4 }}>{l.code}</div>
                                <span className="sp-badge sp-badge--success">{l.name}</span>
                                <div className="t-caption" style={{ marginTop: 6 }} data-testid="returnable">
                                  Sold {formatQuantity(l.quantity)} · returned {formatQuantity(l.returned)} · returnable {formatQuantity(returnable(l))} {l.unit}
                                </div>
                                {itemErr[l.saleItemId] && (
                                  <div className="sp-error" style={{ marginTop: 6 }}>
                                    {itemErr[l.saleItemId]}
                                  </div>
                                )}
                              </td>
                              <td>{money(l.netUnitPrice)}</td>
                              <td>
                                <span className="sp-badge sp-badge--warning" data-testid="stock" title="Current stock in the sale warehouse — the return adds to it">
                                  {formatQuantity(l.stock)} {l.unit}
                                </span>
                              </td>
                              <td>
                                <span className="sp-qty">
                                  <button type="button" className="sp-btn sp-btn--secondary sp-btn--icon" aria-label={`Decrease ${l.name}`} onClick={() => step(l, -1)}>
                                    <Icon name="minus" size={18} />
                                  </button>
                                  <input className="sp-input" aria-label={`Return quantity of ${l.name}`} inputMode="decimal" value={q(l.saleItemId)} onChange={(ev) => setLine(l.saleItemId, ev.target.value)} />
                                  <button type="button" className="sp-btn sp-btn--secondary sp-btn--icon" aria-label={`Increase ${l.name}`} onClick={() => step(l, 1)}>
                                    <Icon name="plus" size={18} />
                                  </button>
                                </span>
                              </td>
                              <td data-col="discount">{money(c?.discountAmount ?? "0.00")}</td>
                              <td data-col="tax">{money(c?.taxAmount ?? "0.00")}</td>
                              <td data-col="subtotal">{money(c?.subtotal ?? "0.00")}</td>
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

              <div className="sp-sum" data-testid="return-summary">
                <div>
                  <span>Order Tax</span>
                  <span data-testid="sum-tax">
                    {money(calc?.orderTaxAmount ?? "0.00")} ({src ? src.orderTaxRate : "0.00"}) %
                  </span>
                </div>
                <div>
                  <span>Discount</span>
                  <span data-testid="sum-discount">{money(calc?.discount ?? "0.00")}</span>
                </div>
                <div>
                  <span>Shipping</span>
                  <span data-testid="sum-shipping">{money("0.00")}</span>
                </div>
                <div>
                  <span>Grand Total</span>
                  <span data-testid="sum-grand">{money(calc?.grandTotal ?? "0.00")}</span>
                </div>
              </div>
              <span className="t-caption">
                Prices, tax and discounts come from the original sale. Order tax and discount are shared out in proportion to what is returned; shipping is not returned. The return reduces the sale&apos;s due — no cash/bank, refund or payment is recorded.
              </span>

              {field("status", "Status", <select id="sr-status" className="sp-select " disabled value="c"><option value="c">Completed</option></select>, true, { width: "33%", minWidth: 260 }, "Saving adds the returned quantities back to the warehouse stock.")}
              {field("notes", "Notes", <textarea id="sr-notes" className="sp-textarea " rows={4} placeholder="Enter Notes (e.g. reason for the return)" maxLength={2000} value={notes} onChange={(ev) => setNotes(ev.target.value)} />)}
            </div>
            <div className="sp-form-actions">
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => router.push("/sales/returns")} disabled={pending}>
                Cancel
              </button>
              <button type="submit" className="sp-btn sp-btn--primary" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </form>
      )}

      {remove && (
        <ConfirmDeleteModal
          itemType="product"
          itemName={remove.name}
          onCancel={() => setRemove(null)}
          onConfirm={() => {
            setRemoved(new Set([...removed, remove.saleItemId]));
            setRemove(null);
          }}
        />
      )}
    </>
  );
}
