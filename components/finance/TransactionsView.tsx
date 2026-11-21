"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import Modal from "@/components/ui/Modal";
import Pagination, { paginate } from "@/components/ui/Pagination";
import RowMenu from "@/components/ui/RowMenu";
import StatCard from "@/components/ui/StatCard";
import { Field } from "@/components/finance/AccountsView";
import { createDeposit, createTransfer, createWithdrawal, type FinanceResult } from "@/app/(dashboard)/finance/actions";
import { formatMoney } from "@/lib/money";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import { fromUnits, toUnits } from "@/lib/transfers";
import {
  DEFERRED_DEPOSIT_SOURCES,
  DEFERRED_WITHDRAWAL_PURPOSES,
  DEPOSIT_SOURCES,
  PAYMENT_METHODS,
  TX_PREFIX,
  TX_TONE,
  WITHDRAWAL_PURPOSES,
  type AccountOption,
  type CurrencyView,
  type TxField,
  type TxRow,
  type TxTypeValue,
} from "@/lib/cash-bank";

// Port of design/Cash - Bank Transactions.html: PageHeader (Transfer Between Accounts / New
// Withdrawal / New Deposit), KPI cards, filter card (dates / account / type / method), search +
// sort toolbar, ledger table with row menu, details modal, deposit / withdrawal / transfer modals.
// Real ledger rows only (append-only: no edit/delete). Only generic manual deposits, withdrawals
// and internal transfers are possible; design choices that need Sales / Purchases / Expenses are
// shown disabled with an explanation. The server re-validates and re-checks balances atomically.

type Filters = { from: string; to: string; acct: string; kind: "ALL" | TxTypeValue; method: string };
const NO_FILTERS: Filters = { from: "", to: "", acct: "ALL", kind: "ALL", method: "ALL" };
const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
const units = (v: string | null) => (v ? toUnits(v, 2) : BigInt(0));

export default function TransactionsView({
  rows: all,
  accounts,
  defaultCurrency,
  initialAccount,
  today,
  canRecord,
}: {
  rows: TxRow[];
  accounts: AccountOption[];
  defaultCurrency: (CurrencyView & { id: string }) | null;
  initialAccount: string;
  today: string;
  canRecord: boolean;
}) {
    const router = useRouter();
  const T = useT();
  const F = T.finance;
  const X = F.transactions;
  const meth = (m: string) => (T.sales.methods as Record<string, string>)[m] ?? m;
  const purp = (p: string) => (F.purposes as Record<string, string>)[p] ?? p;
  const start: Filters = { ...NO_FILTERS, acct: initialAccount || "ALL" };
  const [draft, setDraft] = useState<Filters>(start);
  const [ap, setAp] = useState<Filters>(start);
  const [ferr, setFerr] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"new" | "old" | "in" | "out">("new");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [view, setView] = useState<TxRow | null>(null);
  const [flow, setFlow] = useState<null | "DEPOSIT" | "WITHDRAWAL" | "TRANSFER">(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [e, setE] = useState<Partial<Record<TxField, string>>>({});
  const [pending, startTransition] = useTransition();

  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const activeAccounts = accounts.filter((a) => a.active);
  const money = (v: string, c: CurrencyView | null = defaultCurrency) => formatMoney(v, c);

  const needle = q.trim().toLowerCase();
  let rows = all.filter(
    (t) =>
      (!ap.from || t.date >= ap.from) &&
      (!ap.to || t.date <= ap.to) &&
      (ap.acct === "ALL" || t.accountId === ap.acct || t.toAccountId === ap.acct) &&
      (ap.kind === "ALL" || t.type === ap.kind) &&
      (ap.method === "ALL" || t.paymentMethod === ap.method) &&
      (!needle || [t.reference, t.description, t.accountName, t.toAccountName ?? ""].join(" ").toLowerCase().includes(needle)),
  );
  const newest = (a: TxRow, b: TxRow) => b.date.localeCompare(a.date) || b.number - a.number;
  rows = [...rows].sort((a, b) =>
    sort === "old" ? a.date.localeCompare(b.date) || a.number - b.number : sort === "in" ? Number(units(b.moneyIn) - units(a.moneyIn)) || newest(a, b) : sort === "out" ? Number(units(b.moneyOut) - units(a.moneyOut)) || newest(a, b) : newest(a, b),
  );
  const p = paginate(rows, page, size);
  const moneyIn = rows.reduce((s, t) => s + units(t.moneyIn), BigInt(0));
  const moneyOut = rows.reduce((s, t) => s + units(t.moneyOut), BigInt(0));
  const filtered = !!needle || JSON.stringify(ap) !== JSON.stringify(NO_FILTERS);

  const apply = () => {
    if (draft.from && draft.to && draft.from > draft.to) return setFerr(X.rangeError);
    setFerr("");
    setAp(draft);
    setPage(1);
  };
  const reset = () => {
    setDraft(NO_FILTERS);
    setAp(NO_FILTERS);
    setFerr("");
    setQ("");
    setPage(1);
    if (initialAccount) router.replace("/finance/transactions");
  };

  const open = (k: "DEPOSIT" | "WITHDRAWAL" | "TRANSFER") => {
    if (!activeAccounts.length) return void toast.error(X.noActive, { id: "cash-tx" });
    setE({});
    setF(k === "TRANSFER" ? { transactionDate: today, fromAccountId: "", toAccountId: "", amount: "", notes: "" } : { transactionDate: today, accountId: initialAccount && byId.get(initialAccount)?.active ? initialAccount : "", amount: "", purpose: "", paymentMethod: "Cash", notes: "" });
    setFlow(k);
  };
  const set = (k: string) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setF({ ...f, [k]: ev.target.value });
    setE({ ...e, [k]: "" });
  };

  function save() {
    if (!flow) return;
    const n: Partial<Record<TxField, string>> = {};
    if (!f.transactionDate) n.transactionDate = X.errDateRequired;
    else if (f.transactionDate > today) n.transactionDate = X.errDateFuture;
    const amountOk = MONEY_RE.test((f.amount ?? "").trim()) && /[1-9]/.test(f.amount);
    if (!amountOk) n.amount = X.errAmount;
    const sourceId = flow === "TRANSFER" ? f.fromAccountId : f.accountId;
    if (flow === "TRANSFER") {
      if (!f.fromAccountId) n.fromAccountId = X.errChooseSource;
      if (!f.toAccountId) n.toAccountId = X.errChooseDest;
      else if (f.fromAccountId === f.toAccountId) n.toAccountId = X.errDiffer;
    } else {
      if (!f.accountId) n.accountId = X.errAccount;
      if (!f.purpose) n.purpose = flow === "DEPOSIT" ? X.errDepSource : X.errWdPurpose;
    }
    const src = sourceId ? byId.get(sourceId) : undefined;
    if (amountOk && src && flow !== "DEPOSIT" && toUnits(f.amount, 2) > toUnits(src.balance, 2)) n.amount = fmt(X.errInsufficient, { balance: money(src.balance, src.currency) });
    setE(n);
    if (Object.keys(n).length) return void toast.error(Object.values(n)[0]!, { id: "cash-tx" });
    const payload = { ...f, amount: f.amount.trim() };
    startTransition(async () => {
      let r: FinanceResult<TxField>;
      try {
        r = flow === "DEPOSIT" ? await createDeposit(payload) : flow === "WITHDRAWAL" ? await createWithdrawal(payload) : await createTransfer(payload);
      } catch {
        return void toast.error(T.common.somethingWrong, { id: "cash-tx" });
      }
      if (!r.ok) {
        if (r.fieldErrors) setE(r.fieldErrors);
        toast.error(r.message, { id: "cash-tx" });
        router.refresh(); // pick up current balances
        return;
      }
      toast.success(r.message, { id: "cash-tx" });
      setFlow(null);
      router.refresh();
    });
  }

  const accountSelect = (k: "accountId" | "fromAccountId" | "toAccountId", exclude?: string) => (
    <select id={`ft-${k}`} className={"sp-select " + (f[k] ? "" : "sp-select--placeholder")} value={f[k] ?? ""} onChange={set(k)}>
      <option value="" disabled>
                {X.chooseAccount}
      </option>
      {accounts
        .filter((a) => a.id !== exclude)
        .map((a) => (
          <option key={a.id} value={a.id} disabled={!a.active}>
            {a.name}
            {a.active ? "" : X.inactiveSuffix}
          </option>
        ))}
    </select>
  );
  /**
   * Balance After (display only — the values come from the server's running ledger). Deposits and
   * withdrawals: their account. Transfers: the filtered account's side when an Account filter is
   * applied (source → source balance, destination → destination balance); with All Accounts,
   * both sides, labelled.
   */
  const balanceAfterCell = (t: TxRow) => {
    if (t.type !== "TRANSFER" || !t.toBalanceAfter) return <b>{money(t.balanceAfter, t.currency)}</b>;
    if (ap.acct === t.toAccountId) return <b data-side="destination">{money(t.toBalanceAfter, t.currency)}</b>;
    if (ap.acct === t.accountId) return <b data-side="source">{money(t.balanceAfter, t.currency)}</b>;
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 2, whiteSpace: "nowrap", font: "400 13px/18px var(--font-body)" }} data-side="both">
        <span data-side="source">
          <span style={{ color: "var(--text-3)" }}>{X.sourceLabel} </span>
          <b>{money(t.balanceAfter, t.currency)}</b>
        </span>
        <span data-side="destination">
          <span style={{ color: "var(--text-3)" }}>{X.destLabel} </span>
          <b>{money(t.toBalanceAfter, t.currency)}</b>
        </span>
      </span>
    );
  };
  const kindBadge = (t: TxTypeValue) => <span className={`sp-badge sp-badge--${TX_TONE[t]}`} data-type={t}>{F.tx[t]}</span>;
  const sourceOf = flow === "TRANSFER" ? f.fromAccountId : f.accountId;
  const srcAcc = sourceOf ? byId.get(sourceOf) : undefined;
  const symbol = srcAcc?.currency.symbol ?? defaultCurrency?.symbol ?? "—";
  const noAccounts = activeAccounts.length === 0;

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
                    {X.title}
        </h1>
        {canRecord && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {(
              [
                ["TRANSFER", X.newTransfer, "arrow-left-right", "secondary"],
                ["WITHDRAWAL", X.newWithdrawal, "plus", "secondary"],
                ["DEPOSIT", X.newDeposit, "plus", "primary"],
              ] as const
            ).map(([k, label, icon, variant]) => (
              <button key={k} data-testid={`tx-new-${k.toLowerCase()}`} type="button" className={`sp-btn sp-btn--${variant}`} onClick={() => open(k)} disabled={noAccounts || (k === "TRANSFER" && activeAccounts.length < 2)} title={noAccounts ? X.addAccountFirst : k === "TRANSFER" && activeAccounts.length < 2 ? X.needTwo : undefined}>
                <Icon name={icon} size={18} />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="t-body" style={{ margin: "-8px 0 24px", color: "var(--text-2)" }}>
                {X.subtitle}
</p>

      {accounts.length === 0 && (
        <div className="sp-badge sp-badge--warning" role="status" data-testid="no-accounts" style={{ height: "auto", padding: "10px 14px", whiteSpace: "normal", marginBottom: 24 }}>
          <Icon name="info" size={16} />
          <span>
            {X.noAccountsBanner} <Link href="/finance/accounts">{X.accountsLink}</Link>.
          </span>
        </div>
      )}

      <div className="sp-kpi-grid bp-fin-kpis" style={{ marginBottom: 24 }}>
        <StatCard tone="green" icon="arrow-down-to-line" value={money(fromUnits(moneyIn, 2))} label={X.kpiIn} testId="kpi-in" />
        <StatCard tone="red" icon="arrow-up-from-line" value={money(fromUnits(moneyOut, 2))} label={X.kpiOut} testId="kpi-out" />
        <StatCard tone="blue" icon="chart-column" value={money(fromUnits(moneyIn - moneyOut, 2))} label={X.kpiNet} note={X.kpiNetNote} testId="kpi-net" />
        <StatCard tone="violet" icon="list" value={String(rows.length)} label={X.kpiCount} note={X.kpiCountNote} testId="kpi-count" />
      </div>

      <div className="sp-card" style={{ padding: 24, marginBottom: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 20 }}>
          <Field label={X.fromDate} htmlFor="fl-from">
            <input id="fl-from" type="date" className="sp-input " value={draft.from} onChange={(ev) => setDraft({ ...draft, from: ev.target.value })} />
          </Field>
          <Field label={X.toDate} htmlFor="fl-to">
            <input id="fl-to" type="date" className="sp-input " value={draft.to} onChange={(ev) => setDraft({ ...draft, to: ev.target.value })} />
          </Field>
          <Field label={X.account} htmlFor="fl-acct">
            <select id="fl-acct" className="sp-select " value={draft.acct} onChange={(ev) => setDraft({ ...draft, acct: ev.target.value })}>
              <option value="ALL">{X.allAccounts}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={X.txType} htmlFor="fl-kind">
            <select id="fl-kind" className="sp-select " value={draft.kind} onChange={(ev) => setDraft({ ...draft, kind: ev.target.value as Filters["kind"] })}>
              <option value="ALL">{X.allTx}</option>
              <option value="DEPOSIT">{F.tx.DEPOSIT}</option>
              <option value="WITHDRAWAL">{F.tx.WITHDRAWAL}</option>
              <option value="TRANSFER">{F.tx.TRANSFER}</option>
            </select>
          </Field>
          <Field label={X.method} htmlFor="fl-method">
            <select id="fl-method" className="sp-select " value={draft.method} onChange={(ev) => setDraft({ ...draft, method: ev.target.value })}>
              <option value="ALL">{X.allMethods}</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {meth(m)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 20, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="sp-btn sp-btn--primary" onClick={apply}>
            <Icon name="filter" size={18} />
                        {X.apply}
</button>
          <button type="button" className="sp-btn sp-btn--secondary" onClick={reset}>
            <Icon name="rotate-ccw" size={18} />
                        {X.resetFilters}
          </button>
          {ferr && <span className="sp-error">{ferr}</span>}
        </div>
      </div>

      <div className="sp-toolbar">
        <div className="sp-group">
          <Icon name="search" size={18} className="sp-input-icon" />
          <input className="sp-input " placeholder={X.searchPh} aria-label={X.searchAria} value={q} onChange={(ev) => { setQ(ev.target.value); setPage(1); }} />
        </div>
        <div style={{ width: 220 }}>
          <select className="sp-select " aria-label={X.sortAria} value={sort} onChange={(ev) => { setSort(ev.target.value as typeof sort); setPage(1); }}>
            <option value="new">{X.sortNew}</option>
            <option value="old">{X.sortOld}</option>
            <option value="in">{X.sortIn}</option>
            <option value="out">{X.sortOut}</option>
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="sp-card sp-empty" data-testid="tx-empty">
          <Icon name="inbox" size={36} />
          <div className="t-section-title">{filtered ? X.emptyFiltered : X.emptyNone}</div>
          {filtered ? (
            <button type="button" className="sp-btn sp-btn--secondary" onClick={reset}>
                            {X.resetFilters}
            </button>
          ) : (
            <span>{canRecord && !noAccounts ? X.emptyHintRecord : X.emptyHintOther}</span>
          )}
        </div>
      ) : (
        <div className="sp-table-card">
          <div className="sp-table-scroll">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>{X.colWhen}</th>
                  <th>{X.colReference}</th>
                  <th>{X.colAccount}</th>
                  <th>{X.colType}</th>
                  <th>{X.colDescription}</th>
                  <th className="num">{X.colIn}</th>
                  <th className="num">{X.colOut}</th>
                  <th className="num">{X.colAfter}</th>
                  <th>{X.colStatus}</th>
                  <th className="act">{X.colAction}</th>
                </tr>
              </thead>
              <tbody>
                {p.visible.map((t) => (
                  <tr key={t.id} data-ref={t.reference}>
                    <td style={{ whiteSpace: "nowrap" }}>{t.when}</td>
                    <td>
                      <span className="sp-code">{t.reference}</span>
                    </td>
                    <td>
                      {t.type === "TRANSFER" ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          {t.accountName}
                          <Icon name="arrow-right" size={14} />
                          {t.toAccountName}
                        </span>
                      ) : (
                        t.accountName
                      )}
                    </td>
                    <td>{kindBadge(t.type)}</td>
                    <td className="primary-cell">
                      <div>{t.description}</div>
                      {t.type === "TRANSFER" && <div style={{ color: "var(--primary-700)", fontWeight: 600, fontSize: 13 }}>{fmt(X.transferred, { amount: money(t.amount, t.currency) })}</div>}
                    </td>
                    <td className="num" data-col="in">{t.moneyIn ? <span style={{ color: "var(--success-700)", fontWeight: 600 }}>{money(t.moneyIn, t.currency)}</span> : "—"}</td>
                    <td className="num" data-col="out">{t.moneyOut ? <span style={{ color: "var(--danger-500)", fontWeight: 600 }}>{money(t.moneyOut, t.currency)}</span> : "—"}</td>
                    <td className="num" data-col="after">
                      {balanceAfterCell(t)}
                    </td>
                    <td>
                      <span className="sp-badge sp-badge--success">
                        <i />
                                                {X.completed}
                      </span>
                    </td>
                    <td className="act">
                      <RowMenu label={t.reference} items={[{ label: X.viewDetails, icon: "eye", onClick: () => setView(t) }, { label: X.viewAccount, icon: "landmark", href: "/finance/accounts" }]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={p.current} last={p.last} pageSize={size} from={p.from} to={p.to} total={p.total} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} />
        </div>
      )}
      <p className="t-caption" style={{ marginTop: 12 }}>
                {X.note}
</p>

      {(flow === "DEPOSIT" || flow === "WITHDRAWAL") && (
        <Modal
          size="md"
          title={flow === "DEPOSIT" ? X.depTitle : X.wdTitle}
          onClose={() => !pending && setFlow(null)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setFlow(null)} disabled={pending}>
                {X.cancel}
</button>
              <button type="button" className="sp-btn sp-btn--primary" onClick={save} disabled={pending}>
                {pending ? X.saving : flow === "DEPOSIT" ? X.saveDeposit : X.saveWithdrawal}
              </button>
            </>
          }
        >
          <div className="sp-form-grid">
            <Field label={flow === "DEPOSIT" ? X.depSource : X.wdPurpose} required error={e.purpose} htmlFor="ft-purpose">
              <select id="ft-purpose" className={"sp-select " + (f.purpose ? "" : "sp-select--placeholder")} value={f.purpose ?? ""} onChange={set("purpose")}>
                <option value="" disabled>
                  {flow === "DEPOSIT" ? X.chooseDepSource : X.chooseWdPurpose}
                </option>
                {(flow === "DEPOSIT" ? DEPOSIT_SOURCES : WITHDRAWAL_PURPOSES).map((o) => (
                  <option key={o} value={o}>
                                        {purp(o)}
                  </option>
                ))}
                {(flow === "DEPOSIT" ? DEFERRED_DEPOSIT_SOURCES : DEFERRED_WITHDRAWAL_PURPOSES).map((o) => (
                  <option key={o.label} value={`deferred:${o.label}`} disabled title={(F.deferred as Record<string, string>)[o.label] ?? o.reason}>
                    {purp(o.label)} — {(F.deferred as Record<string, string>)[o.label] ?? o.reason}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={flow === "DEPOSIT" ? X.destAccount : X.srcAccount} required error={e.accountId} htmlFor="ft-accountId">
              {accountSelect("accountId")}
            </Field>
            <Field label={X.amount} required error={e.amount} htmlFor="ft-amount" hint={flow === "WITHDRAWAL" && srcAcc ? fmt(X.available, { balance: money(srcAcc.balance, srcAcc.currency) }) : undefined}>
              <div className="sp-group">
                <input id="ft-amount" className="sp-input " inputMode="decimal" placeholder="0.00" value={f.amount ?? ""} onChange={set("amount")} />
                <span className="sp-addon sp-addon--r">{symbol}</span>
              </div>
            </Field>
            <Field label={flow === "DEPOSIT" ? X.depDate : X.wdDate} required error={e.transactionDate} htmlFor="ft-transactionDate">
              <input id="ft-transactionDate" type="date" className="sp-input " max={today} value={f.transactionDate ?? ""} onChange={set("transactionDate")} />
            </Field>
            <Field label={X.paymentMethod} htmlFor="ft-paymentMethod" error={e.paymentMethod}>
              <select id="ft-paymentMethod" className="sp-select " value={f.paymentMethod ?? "Cash"} onChange={set("paymentMethod")}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {meth(m)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={X.txRef} htmlFor="ft-ref" hint={X.refHint}>
              <input id="ft-ref" className="sp-input " value={fmt(X.autoRef, { prefix: TX_PREFIX[flow] })} dir="ltr" readOnly disabled />
            </Field>
            <Field label={X.notes} htmlFor="ft-notes" className="sp-span-all" error={e.notes}>
              <textarea id="ft-notes" className="sp-textarea " rows={3} placeholder={X.notesPh} value={f.notes ?? ""} onChange={set("notes")} />
            </Field>
            <span className="t-caption sp-span-all">
                            {X.deferredNote}
</span>
          </div>
        </Modal>
      )}

      {flow === "TRANSFER" && (
        <Modal
          size="md"
          title={X.transferTitle}
          onClose={() => !pending && setFlow(null)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setFlow(null)} disabled={pending}>
                {X.cancel}
</button>
              <button type="button" className="sp-btn sp-btn--primary" onClick={save} disabled={pending}>
                {pending ? X.saving : X.confirmTransfer}
              </button>
            </>
          }
        >
          <div className="sp-form-grid">
            <Field label={X.transferDate} required error={e.transactionDate} htmlFor="ft-transactionDate">
              <input id="ft-transactionDate" type="date" className="sp-input " max={today} value={f.transactionDate ?? ""} onChange={set("transactionDate")} />
            </Field>
            <div />
            <Field label={X.fromAccount} required error={e.fromAccountId} htmlFor="ft-fromAccountId">
              {accountSelect("fromAccountId", f.toAccountId)}
            </Field>
            <Field label={X.toAccount} required error={e.toAccountId} htmlFor="ft-toAccountId">
              {accountSelect("toAccountId", f.fromAccountId)}
            </Field>
            <Field label={X.amount} required error={e.amount} htmlFor="ft-amount" hint={srcAcc ? fmt(X.availableSource, { balance: money(srcAcc.balance, srcAcc.currency) }) : undefined}>
              <div className="sp-group">
                <input id="ft-amount" className="sp-input " inputMode="decimal" placeholder="0.00" value={f.amount ?? ""} onChange={set("amount")} />
                <span className="sp-addon sp-addon--r">{symbol}</span>
              </div>
            </Field>
            <Field label={X.transferRef} htmlFor="ft-ref" hint={X.refHint}>
              <input id="ft-ref" className="sp-input " value={fmt(X.autoRef, { prefix: "TRF_" })} readOnly disabled />
            </Field>
            {f.fromAccountId && f.toAccountId && (
              <div className="sp-span-all" data-testid="transfer-preview" style={{ background: "var(--primary-50)", border: "1px solid var(--primary-100)", borderRadius: "var(--radius-md)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", font: "600 14px/20px var(--font-body)" }}>
                <span>{byId.get(f.fromAccountId)?.name}</span>
                <Icon name="arrow-right" size={18} />
                <span>{byId.get(f.toAccountId)?.name}</span>
                <span style={{ marginLeft: "auto", color: "var(--primary-700)" }}>{MONEY_RE.test(f.amount ?? "") && /[1-9]/.test(f.amount) ? money(f.amount, srcAcc?.currency ?? defaultCurrency) : ""}</span>
              </div>
            )}
            <Field label={X.notesShort} htmlFor="ft-notes" className="sp-span-all" error={e.notes}>
              <textarea id="ft-notes" className="sp-textarea " rows={3} placeholder={X.notesPh} value={f.notes ?? ""} onChange={set("notes")} />
            </Field>
          </div>
        </Modal>
      )}

      {view && (
        <Modal size="md" title={fmt(X.detTitle, { ref: view.reference })} onClose={() => setView(null)} footer={<button type="button" className="sp-btn sp-btn--secondary" onClick={() => setView(null)}>{X.detClose}</button>}>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "12px 24px", font: "400 14px/20px var(--font-body)" }} data-testid="tx-details">
            {(
              [
                [X.detReference, <span key="r" className="sp-code" style={{ justifySelf: "start" }}>{view.reference}</span>],
                [X.detWhen, view.when],
                [X.detType, kindBadge(view.type)],
                [view.type === "DEPOSIT" ? X.detDest : X.detSource, view.accountName],
                ...(view.type === "TRANSFER" ? ([[X.detDest, view.toAccountName ?? ""]] as const) : []),
                [X.detAmount, <b key="a" style={{ color: view.type === "DEPOSIT" ? "var(--success-700)" : view.type === "WITHDRAWAL" ? "var(--danger-500)" : "var(--primary-700)" }}>{money(view.amount, view.currency)}</b>],
                [X.detDescription, view.description],
                ...(view.paymentMethod ? ([[X.detMethod, meth(view.paymentMethod)]] as const) : []),
                ...(view.purpose ? ([[view.type === "DEPOSIT" ? X.detDepSource : X.detPurpose, purp(view.purpose)]] as const) : []),
                [view.type === "TRANSFER" ? X.detSrcAfter : X.detAfter, money(view.balanceAfter, view.currency)],
                ...(view.type === "TRANSFER" && view.toBalanceAfter ? ([[X.detDstAfter, money(view.toBalanceAfter, view.currency)]] as const) : []),
                [X.detStatus, <span key="s" className="sp-badge sp-badge--success"><i />{X.completed}</span>],
                [X.detNotes, view.notes || "—"],
              ] as [string, React.ReactNode][]
            ).map(([k, v]) => (
              <Fragment key={k}>
                <b>{k}</b>
                <span>{v}</span>
              </Fragment>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
