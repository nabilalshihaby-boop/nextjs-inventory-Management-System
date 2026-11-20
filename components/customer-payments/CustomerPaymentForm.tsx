"use client";

import Link from "next/link";
import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { recordCustomerPayment, type CustomerPaymentResult } from "@/app/(dashboard)/customer-payments/actions";
import { PAYMENT_METHODS } from "@/lib/cash-bank";
import { formatMoney } from "@/lib/money";
import { fromUnits, toUnits } from "@/lib/transfers";
import { UNALLOCATED_SOON, type PayableSale, type ReceivingAccount, type PaymentCurrency, type CustomerPaymentField } from "@/lib/customer-payments";

// Record Customer Payment — the design's PaymentModal (kind "customer") as a full page, following
// the Record Supplier Payment pattern: Customer (+ Add Customer), Payment Date, Payment Method,
// Amount, "Deposit To — Cash / Bank Account", Payment Reference, "Apply Payment To" with the
// customer's unpaid COMPLETED sales, Notes. Each ticked sale gets its own amount (prefilled with its
// Due = Grand Total − Returned − Paid), and Amount is the read-only sum, so a receipt never exceeds
// what is owed. "Unallocated Payment" (customer credit/advance) is shown disabled. Every figure here
// is a preview — the server re-reads dues, returns, payments and currency under locks when saving.
const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;

export default function CustomerPaymentForm({
  customers,
  payables,
  accounts,
  currencies,
  today,
  initialCustomer,
  initialSale,
}: {
  customers: { id: string; name: string }[];
  payables: PayableSale[];
  accounts: ReceivingAccount[];
  currencies: PaymentCurrency[];
  today: string;
  initialCustomer: string;
  initialSale: string;
}) {
  const router = useRouter();
  const pre = payables.find((p) => p.id === initialSale && p.customerId === initialCustomer);
  const [customerId, setCustomerId] = useState(initialCustomer);
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<string>("Cash");
  const [accountId, setAccountId] = useState("");
  const [extRef, setExtRef] = useState("");
  const [notes, setNotes] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>(pre ? { [pre.id]: pre.due } : {});
  const [e, setE] = useState<Partial<Record<CustomerPaymentField, string>>>({});
  const [lineErr, setLineErr] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const cur = (id: string | undefined) => currencies.find((c) => c.id === id) ?? null;
  const invoices = customerId ? payables.filter((p) => p.customerId === customerId) : [];
  const picked = invoices.filter((i) => i.id in alloc);
  const pickedCurrencies = [...new Set(picked.map((i) => i.currencyId))];
  const currencyId = pickedCurrencies.length === 1 ? pickedCurrencies[0] : picked.length ? null : (invoices[0]?.currencyId ?? null);
  const currency = cur(currencyId ?? undefined);
  const money = (v: string, c: PaymentCurrency | null = currency) => formatMoney(v, c);
  const units = (v: string | undefined) => (v && MONEY_RE.test(v.trim()) ? toUnits(v.trim(), 2) : BigInt(0));
  const total = picked.reduce((s, i) => s + units(alloc[i.id]), BigInt(0));
  const dueSel = picked.reduce((s, i) => s + toUnits(i.due, 2), BigInt(0));
  const usable = accounts.filter((a) => !currencyId || a.currencyId === currencyId);
  const account = usable.find((a) => a.id === accountId) ?? null;
  const minDate = picked.reduce((m, i) => (i.date > m ? i.date : m), "");

  const clearErr = (k: CustomerPaymentField) => setE((x) => ({ ...x, [k]: "" }));
  const chooseCustomer = (id: string) => {
    setCustomerId(id);
    setAlloc({});
    setLineErr({});
    setE({});
  };
  const toggle = (i: PayableSale, on: boolean) => {
    setAlloc((x) => {
      const n = { ...x };
      if (on) n[i.id] = i.due;
      else delete n[i.id];
      return n;
    });
    setLineErr((x) => ({ ...x, [i.id]: "" }));
    clearErr("allocations");
    clearErr("amount");
  };
  const setLine = (id: string, v: string) => {
    setAlloc((x) => ({ ...x, [id]: v }));
    setLineErr((x) => ({ ...x, [id]: "" }));
    clearErr("allocations");
    clearErr("amount");
  };

  function lineProblem(i: PayableSale): string {
    const v = (alloc[i.id] ?? "").trim();
    if (!v) return "Enter the amount to pay";
    if (!MONEY_RE.test(v)) return "Use a number with up to 2 decimal places";
    if (toUnits(v, 2) <= BigInt(0)) return "Must be greater than 0";
    if (toUnits(v, 2) > toUnits(i.due, 2)) return `More than the ${money(i.due, cur(i.currencyId))} still due`;
    return "";
  }

  function save() {
    const n: Partial<Record<CustomerPaymentField, string>> = {};
    const le: Record<string, string> = {};
    if (!customerId) n.customerId = "Customer is required";
    if (!date) n.paymentDate = "Payment date is required";
    else if (date > today) n.paymentDate = "The date can't be in the future";
    else if (minDate && date < minDate) n.paymentDate = "The payment date can't be before the date of a selected sale";
    if (customerId && !picked.length) n.allocations = invoices.length ? "Select at least one invoice to pay" : "This customer has no unpaid completed sales";
    for (const i of picked) {
      const p = lineProblem(i);
      if (p) le[i.id] = p;
    }
    if (Object.keys(le).length) n.allocations = Object.values(le)[0];
    if (pickedCurrencies.length > 1) n.allocations = "Selected invoices must use the same currency";
    if (!accountId || !account) n.cashBankAccountId = "Select an account";
    if (picked.length && !Object.keys(le).length && total <= BigInt(0)) n.amount = "Enter an amount greater than 0";
    setE(n);
    setLineErr(le);
    if (Object.keys(n).length) return void toast.error(Object.values(n)[0]!, { id: "sp" });
    // Ids + the allocation amounts only; the server derives dues, balances, currency and references.
    const payload = {
      customerId,
      paymentDate: date,
      paymentMethod: method,
      cashBankAccountId: accountId,
      amount: fromUnits(total, 2),
      externalReference: extRef,
      notes,
      allocations: picked.map((i) => ({ saleId: i.id, amount: (alloc[i.id] ?? "").trim() })),
    };
    startTransition(async () => {
      let r: CustomerPaymentResult;
      try {
        r = await recordCustomerPayment(payload);
      } catch {
        return void toast.error("Something went wrong. Please try again.", { id: "sp" });
      }
      if (!r.ok) {
        if (r.fieldErrors) setE(r.fieldErrors);
        toast.error(r.message, { id: "sp", duration: 7000 });
        router.refresh(); // current dues / balances
        return;
      }
      toast.success(r.message, { id: "sp", duration: 6000 });
      router.push("/customer-payments");
      router.refresh();
    });
  }

  const field = (k: CustomerPaymentField, label: string, child: ReactNode, opts: { required?: boolean; span?: boolean; hint?: ReactNode } = {}) => (
    <div className={"sp-field" + (e[k] ? " sp-field--error" : "") + (opts.span ? " sp-span-all" : "")}>
      <label className="sp-label" htmlFor={`sp-${k}`}>
        {label}
        {opts.required && <i>*</i>}
      </label>
      {child}
      {e[k] ? <span className="sp-error" id={`sp-${k}-error`}>{e[k]}</span> : opts.hint ? <span className="sp-hint">{opts.hint}</span> : null}
    </div>
  );

  const setup = !customers.length ? "customers" : !accounts.length ? "accounts" : null;

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          Record Customer Payment
        </h1>
        <Link href="/customer-payments" className="sp-btn sp-btn--secondary">
          <Icon name="arrow-left" size={18} />
          Back
        </Link>
      </div>

      {setup ? (
        <div className="sp-card sp-empty" data-testid="sp-setup">
          <Icon name={setup === "customers" ? "inbox" : "wallet"} size={36} />
          <div className="t-section-title">{setup === "customers" ? "No customers yet" : "No active cash or bank account"}</div>
          <span>{setup === "customers" ? "Add a customer and complete a sale before recording a customer payment." : "A customer payment is deposited to an active cash or bank account. Create or activate one first."}</span>
          <Link href={setup === "customers" ? "/customers/create" : "/finance/accounts"} className="sp-btn sp-btn--secondary">
            {setup === "customers" ? "Add Customer" : "Go to Cash & Bank Accounts"}
          </Link>
        </div>
      ) : (
        <form noValidate aria-busy={pending} onSubmit={(ev) => { ev.preventDefault(); save(); }}>
          <div className="sp-card sp-form-card">
            <div className="sp-form-grid" style={{ "--cols": 2 } as CSSProperties}>
              {field(
                "customerId",
                "Customer",
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <select id="sp-customerId" className={"sp-select " + (customerId ? "" : "sp-select--placeholder")} value={customerId} onChange={(ev) => chooseCustomer(ev.target.value)} aria-invalid={!!e.customerId || undefined}>
                      <option value="" disabled>
                        Choose Customer
                      </option>
                      {customers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Link href="/customers/create" className="sp-btn sp-btn--secondary">
                    <Icon name="plus" size={18} />
                    Add Customer
                  </Link>
                </div>,
                { required: true },
              )}
              {field("paymentDate", "Payment Date", <input id="sp-paymentDate" type="date" className="sp-input " min={minDate || undefined} max={today} value={date} onChange={(ev) => { setDate(ev.target.value); clearErr("paymentDate"); }} aria-invalid={!!e.paymentDate || undefined} />, { required: true })}
              {field(
                "paymentMethod",
                "Payment Method",
                <select id="sp-paymentMethod" className="sp-select " value={method} onChange={(ev) => setMethod(ev.target.value)}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>,
              )}
              {field(
                "amount",
                "Amount",
                <input id="sp-amount" className="sp-input " readOnly value={money(fromUnits(total, 2))} data-testid="sp-amount" aria-readonly="true" style={{ background: "var(--neutral-100)" }} />,
                { required: true, hint: "The sum of the amounts applied to the selected invoices." },
              )}
              {field(
                "cashBankAccountId",
                "Deposit To — Cash / Bank Account",
                <select id="sp-cashBankAccountId" className={"sp-select " + (account ? "" : "sp-select--placeholder")} value={account ? accountId : ""} onChange={(ev) => { setAccountId(ev.target.value); clearErr("cashBankAccountId"); }} aria-invalid={!!e.cashBankAccountId || undefined}>
                  <option value="" disabled>
                    Choose Account
                  </option>
                  {usable.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {money(a.balance, cur(a.currencyId))}
                    </option>
                  ))}
                </select>,
                { required: true, hint: currencyId && !usable.length ? `No active account uses ${currency?.code ?? "this currency"}.` : "Only active accounts in the invoices' currency are listed." },
              )}
              {field("externalReference", "Payment Reference", <input id="sp-externalReference" className="sp-input " placeholder="Enter Reference" maxLength={64} value={extRef} onChange={(ev) => setExtRef(ev.target.value)} />)}

              {field(
                "allocations",
                "Apply Payment To",
                <div className="sp-card" style={{ padding: 16, boxShadow: "none", display: "flex", flexDirection: "column", gap: 12 }} data-testid="sp-invoices">
                  <label className="sp-check" aria-disabled="true" title={UNALLOCATED_SOON} style={{ opacity: 0.5, cursor: "not-allowed" }}>
                    <input type="checkbox" disabled checked={false} readOnly />
                    Unallocated Payment <span className="t-caption" id="cp-unallocated-why">— {UNALLOCATED_SOON}</span>
                  </label>
                  {!customerId ? (
                    <span className="t-caption">Choose a customer to see their unpaid completed sales.</span>
                  ) : invoices.length === 0 ? (
                    <span className="t-caption" data-testid="sp-no-invoices">This customer has no unpaid completed sales.</span>
                  ) : (
                    <div className="sp-table-scroll">
                      <table className="sp-table">
                        <thead>
                          <tr>
                            <th style={{ width: 40 }} />
                            <th>Invoice</th>
                            <th>Date</th>
                            <th className="num">Invoice Total</th>
                            <th className="num">Already Paid</th>
                            <th className="num">Returned</th>
                            <th className="num">Due</th>
                            <th className="num" style={{ width: 180 }}>Apply</th>
                            <th className="num">Remaining Due</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoices.map((i) => {
                            const on = i.id in alloc;
                            const c = cur(i.currencyId);
                            const rem = toUnits(i.due, 2) - (on ? units(alloc[i.id]) : BigInt(0));
                            return (
                              <tr key={i.id} data-invoice={i.reference}>
                                <td>
                                  <input type="checkbox" aria-label={`Pay ${i.reference}`} checked={on} onChange={(ev) => toggle(i, ev.target.checked)} />
                                </td>
                                <td>
                                  <span className="sp-code">{i.reference}</span>
                                  <div className="t-caption" style={{ marginTop: 4 }}>
                                    {i.status}
                                  </div>
                                </td>
                                <td>{i.dateLabel}</td>
                                <td className="num">{money(i.grandTotal, c)}</td>
                                <td className="num">{money(i.paid, c)}</td>
                                <td className="num">{money(i.returned, c)}</td>
                                <td className="num" data-col="due">{money(i.due, c)}</td>
                                <td className="num">
                                  <input className="sp-input" style={{ textAlign: "right" }} inputMode="decimal" aria-label={`Amount applied to ${i.reference}`} disabled={!on} value={on ? (alloc[i.id] ?? "") : ""} placeholder="0.00" onChange={(ev) => setLine(i.id, ev.target.value)} aria-invalid={!!lineErr[i.id] || undefined} />
                                  {lineErr[i.id] && <div className="sp-error" style={{ marginTop: 4, textAlign: "left" }}>{lineErr[i.id]}</div>}
                                </td>
                                <td className="num" data-col="remaining">{money(fromUnits(rem < BigInt(0) ? BigInt(0) : rem, 2), c)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {picked.length > 0 && (
                    <span className="t-caption" data-testid="sp-summary">
                      Selected invoices due {money(fromUnits(dueSel, 2))}. {money(fromUnits(total, 2))} will be applied; {money(fromUnits(dueSel - total < BigInt(0) ? BigInt(0) : dueSel - total, 2))} stays due.
                    </span>
                  )}
                </div>,
                { required: true, span: true },
              )}
              {field("notes", "Notes", <textarea id="sp-notes" className="sp-textarea " rows={4} placeholder="Enter Notes" maxLength={2000} value={notes} onChange={(ev) => setNotes(ev.target.value)} />, { span: true })}
            </div>
            <div className="sp-form-actions">
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => router.push("/customer-payments")} disabled={pending}>
                Cancel
              </button>
              <button type="submit" className="sp-btn sp-btn--primary" disabled={pending}>
                {pending ? "Saving…" : "Save Payment"}
              </button>
            </div>
          </div>
        </form>
      )}
    </>
  );
}
