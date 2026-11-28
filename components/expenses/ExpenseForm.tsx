"use client";

import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import Link from "next/link";
import { Fragment, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { createExpense, updateExpense, type ExpenseResult } from "@/app/(dashboard)/expenses/actions";
import { formatMoney } from "@/lib/money";
import { fromUnits, toUnits } from "@/lib/transfers";
import type { ExpenseField, ExpenseFormValues, ExpenseOption, PaidFromOption } from "@/lib/expenses";

// Port of design/Create Expense.html and design/Update Expense.html: PageHeader (+ Back),
// FormCard (2 columns, Cancel / Save or Update): Date, Expense Title, Warehouse, Expense Category,
// Amount (+ the default currency), Details — plus the required "Paid From" cash/bank account next
// to Amount (every real expense deducts money from an account). All options are real MySQL data;
// the server re-validates everything and applies the ledger rules atomically.

const EMPTY: ExpenseFormValues = { expenseDate: "", title: "", warehouseId: "", categoryId: "", cashBankAccountId: "", amount: "", details: "" };
const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;

export default function ExpenseForm({
  warehouses,
  categories,
  accounts,
  currency,
  today,
  canOpenSettings,
  expenseId,
  reference,
  activeTransaction,
  initial,
}: {
  warehouses: ExpenseOption[];
  categories: ExpenseOption[];
  accounts: PaidFromOption[];
  currency: { code: string; symbol: string; right: boolean } | null;
  today: string;
  canOpenSettings: boolean;
  expenseId?: string;
  reference?: string;
  activeTransaction?: string | null;
  initial?: ExpenseFormValues;
}) {
    const router = useRouter();
  const T = useT();
  const F = T.expenses.form;
  const editing = !!expenseId;
  const [f, setF] = useState<ExpenseFormValues>(initial ?? { ...EMPTY, expenseDate: today });
  const [e, setE] = useState<Partial<Record<ExpenseField, string>>>({});
  const [pending, startTransition] = useTransition();

  const usable = accounts.filter((a) => a.active && a.inDefaultCurrency);
  const missing: { key: string; text: ReactNode }[] = [];
  if (!currency) missing.push({ key: "currency", text: canOpenSettings ? <Link href="/settings">{F.setupCurrency}</Link> : <>{F.setupCurrencyAsk}</> });
  if (!warehouses.length) missing.push({ key: "warehouse", text: <Link href="/warehouse/create">{F.setupWarehouse}</Link> });
  if (!categories.length) missing.push({ key: "category", text: <Link href="/expenses/categories">{F.setupCategory}</Link> });
  if (!usable.length) missing.push({ key: "account", text: <><Link href="/finance/accounts">{F.setupAccount}</Link>{currency ? fmt(F.setupAccountIn, { currency: currency.code }) : ""}</> });
  const blocked = missing.length > 0;

  const set = (k: ExpenseField) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setF({ ...f, [k]: ev.target.value });
    setE({ ...e, [k]: "" });
  };
  const money = (v: string) => formatMoney(v, currency);
  const selected = accounts.find((a) => a.value === f.cashBankAccountId);
  // When editing and keeping the same account, the original payment is reversed first.
  const available = selected && selected.balance !== null ? (editing && initial && selected.value === initial.cashBankAccountId && MONEY_RE.test(initial.amount) ? fromUnits(toUnits(selected.balance, 2) + toUnits(initial.amount, 2), 2) : selected.balance) : null;

  function save() {
    if (blocked) return;
    const n: Partial<Record<ExpenseField, string>> = {};
    if (!f.expenseDate) n.expenseDate = F.errDateRequired;
    else if (f.expenseDate > today) n.expenseDate = F.errDateFuture;
    if (!f.title.trim()) n.title = T.expenses.val.titleRequired;
    if (!f.warehouseId) n.warehouseId = T.expenses.val.chooseWarehouse;
    if (!f.categoryId) n.categoryId = T.expenses.val.chooseCategory;
    if (!f.cashBankAccountId) n.cashBankAccountId = T.expenses.val.chooseAccount;
    const amt = f.amount.trim();
    if (!amt) n.amount = F.errAmountRequired;
    else if (!MONEY_RE.test(amt) || !/[1-9]/.test(amt)) n.amount = F.errAmountInvalid;
    else if (available !== null && toUnits(amt, 2) > toUnits(available, 2)) n.amount = fmt(F.errInsufficient, { balance: money(available) });
    setE(n);
    if (Object.keys(n).length) return void toast.error(Object.values(n)[0]!, { id: "expense" });
    const payload = { ...f, amount: amt }; // ids, date, amount and text only — never balances or references
    startTransition(async () => {
      let r: ExpenseResult;
      try {
        r = editing ? await updateExpense(expenseId, payload) : await createExpense(payload);
      } catch {
        return void toast.error(T.common.somethingWrong, { id: "expense" });
      }
      if (!r.ok) {
        if (r.fieldErrors) setE(r.fieldErrors);
        toast.error(r.message, { id: "expense", duration: 7000 });
        router.refresh(); // current balances
        return;
      }
      toast.success(r.message, { id: "expense", duration: 6000 });
      router.push("/expenses");
      router.refresh();
    });
  }

  const field = (k: ExpenseField, label: string, child: ReactNode, required = true, hint?: ReactNode) => (
    <div className={"sp-field" + (e[k] ? " sp-field--error" : "")}>
      <label className="sp-label" htmlFor={`ex-${k}`}>
        {label}
        {required && <i>*</i>}
      </label>
      {child}
      {e[k] ? <span className="sp-error" id={`ex-${k}-error`}>{e[k]}</span> : hint ? <span className="sp-hint">{hint}</span> : null}
    </div>
  );
  const select = (k: ExpenseField, placeholder: string, opts: { value: string; label: string; disabled?: boolean }[]) => (
    <select id={`ex-${k}`} className={"sp-select " + (f[k] ? "" : "sp-select--placeholder")} value={f[k]} onChange={set(k)} disabled={!opts.length} aria-invalid={!!e[k] || undefined}>
      <option value="" disabled>
        {opts.length ? placeholder : F.noneYet}
      </option>
      {opts.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {editing ? F.updateTitle : F.createTitle}
        </h1>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/expenses" className="sp-btn sp-btn--secondary">
                        <Icon name="arrow-left" size={18} />
            {F.back}
</Link>
        </div>
      </div>

      {blocked && (
        <div className="sp-badge sp-badge--warning" role="status" data-testid="expense-setup" style={{ height: "auto", padding: "10px 14px", whiteSpace: "normal", marginBottom: 16 }}>
          <Icon name="info" size={16} />
          <span>
                        {editing ? F.beforeUpdating : F.beforeRecording}{" "}
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
      {editing && (
        <div className="sp-badge sp-badge--info" role="note" style={{ height: "auto", padding: "10px 14px", whiteSpace: "normal", marginBottom: 16 }}>
          <Icon name="info" size={16} />
          <span>
                        {fmt(F.reversalNote, { reference: reference ?? "", tx: activeTransaction ? ` (${activeTransaction})` : "" })}
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
          <div className="sp-form-grid" style={{ "--cols": 2 } as CSSProperties}>
            {field("expenseDate", F.date, <input id="ex-expenseDate" type="date" className="sp-input " max={today} value={f.expenseDate} onChange={set("expenseDate")} aria-invalid={!!e.expenseDate || undefined} />)}
            {field("title", F.title, <input id="ex-title" className="sp-input " placeholder={F.titlePh} maxLength={191} value={f.title} onChange={set("title")} aria-invalid={!!e.title || undefined} />)}
            {field("warehouseId", F.warehouse, select("warehouseId", F.chooseWarehouse, warehouses))}
            {field("categoryId", F.category, select("categoryId", F.chooseCategory, categories))}
            {field(
                            "amount",
              F.amount,
              <div className="sp-group">
                <input id="ex-amount" className="sp-input " inputMode="decimal" placeholder={F.amountPh} dir="ltr" value={f.amount} onChange={set("amount")} aria-invalid={!!e.amount || undefined} />
                <span className="sp-addon sp-addon--r">{currency?.symbol ?? "—"}</span>
              </div>,
              true,
              available !== null ? fmt(F.available, { name: selected!.name, balance: money(available) }) + (editing && initial && selected!.value === initial.cashBankAccountId ? F.afterReversing : "") : undefined,
            )}
            {field(
                            "cashBankAccountId",
              F.paidFrom,
              select(
                "cashBankAccountId",
                F.chooseAccount,
                accounts
                  .filter((a) => (a.active && a.inDefaultCurrency) || a.value === f.cashBankAccountId)
                  .map((a) => ({ value: a.value, label: a.active ? a.label : `${a.name}${F.inactiveSuffix}`, disabled: !(a.active && a.inDefaultCurrency) })),
              ),
            )}
            {field("details", F.details, <textarea id="ex-details" className="sp-textarea " rows={4} placeholder={F.detailsPh} maxLength={2000} value={f.details} onChange={set("details")} />, false)}
          </div>
          <div className="sp-form-actions">
            <button type="button" className="sp-btn sp-btn--secondary" onClick={() => router.push("/expenses")} disabled={pending}>
              {F.cancel}
</button>
            <button type="submit" className="sp-btn sp-btn--primary" disabled={pending || blocked} title={blocked ? F.completeSetup : undefined}>
              {pending ? F.saving : editing ? F.update : F.save}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
