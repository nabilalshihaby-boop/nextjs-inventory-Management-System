"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import Modal from "@/components/ui/Modal";
import Pagination, { paginate } from "@/components/ui/Pagination";
import RowMenu, { type RowMenuItem } from "@/components/ui/RowMenu";
import StatCard from "@/components/ui/StatCard";
import { createAccount, setAccountStatus, updateAccount, type FinanceResult } from "@/app/(dashboard)/finance/actions";
import { formatMoney } from "@/lib/money";
import { fromUnits, toUnits } from "@/lib/transfers";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import { type AccountField, type AccountRow, type AccountStatusValue, type AccountTypeValue, type CurrencyView } from "@/lib/cash-bank";

// Port of design/Cash - Bank Accounts.html: PageHeader (+ Add New Account), KPI cards, toolbar
// (search + Type + Status), account table with row menu (View Details / Edit Account / View
// Transactions / Activate–Deactivate), Add/Edit modal and account details modal. All data is real;
// balances are computed on the server from the ledger. Account controls are for OWNER and ADMIN.

type Form = { name: string; type: AccountTypeValue; reference: string; bankName: string; openingBalance: string; status: AccountStatusValue; notes: string };
const BLANK: Form = { name: "", type: "CASH", reference: "", bankName: "", openingBalance: "", status: "ACTIVE", notes: "" };
const sum = (vals: string[]) => fromUnits(vals.reduce((a, v) => a + toUnits(v, 2), BigInt(0)), 2);

export default function AccountsView({
  accounts,
  defaultCurrency,
  canManage,
  canOpenSettings,
}: {
  accounts: AccountRow[];
  defaultCurrency: (CurrencyView & { id: string }) | null;
  canManage: boolean;
  /** System Settings stay OWNER-only, so only the Owner gets a link there. */
  canOpenSettings: boolean;
}) {
    const router = useRouter();
  const T = useT();
  const X = T.finance;
  const A = X.accounts;
  const [q, setQ] = useState("");
  const [ty, setTy] = useState<"ALL" | AccountTypeValue>("ALL");
  const [st, setSt] = useState<"ALL" | AccountStatusValue>("ALL");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [modal, setModal] = useState<null | "add" | AccountRow>(null);
  const [f, setF] = useState<Form>(BLANK);
  const [e, setE] = useState<Partial<Record<AccountField, string>>>({});
  const [view, setView] = useState<AccountRow | null>(null);
  const [pending, startTransition] = useTransition();

  const money = (v: string, c: CurrencyView | null) => formatMoney(v, c);
  const active = accounts.filter((a) => a.status === "ACTIVE" && a.inDefaultCurrency);
  const cash = sum(active.filter((a) => a.type === "CASH").map((a) => a.balance));
  const bank = sum(active.filter((a) => a.type === "BANK").map((a) => a.balance));
  const otherCurrency = accounts.filter((a) => a.status === "ACTIVE" && !a.inDefaultCurrency).length;

  const needle = q.trim().toLowerCase();
  const list = accounts.filter((a) => (!needle || [a.name, a.reference, a.bankName].join(" ").toLowerCase().includes(needle)) && (ty === "ALL" || a.type === ty) && (st === "ALL" || a.status === st));
  const p = paginate(list, page, size);
  const filtered = !!needle || ty !== "ALL" || st !== "ALL";

  const openAdd = () => {
    if (!defaultCurrency) return toast.error(A.noCurrencyToast, { id: "account" });
    setF(BLANK);
    setE({});
    setModal("add");
  };
  const openEdit = (a: AccountRow) => {
    setF({ name: a.name, type: a.type, reference: a.reference, bankName: a.bankName, openingBalance: a.openingBalance, status: a.status, notes: a.notes });
    setE({});
    setModal(a);
  };
  const set = (k: keyof Form) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setF({ ...f, [k]: ev.target.value });
    setE({ ...e, [k]: "" });
  };

  function save() {
    const adding = modal === "add";
    const n: Partial<Record<AccountField, string>> = {};
    if (!f.name.trim()) n.name = X.val.nameRequired;
    if (f.type === "BANK" && !f.bankName.trim()) n.bankName = X.val.bankNameRequired;
    if (f.type === "BANK" && !f.reference.trim()) n.reference = X.val.accountNumberRequired;
    if (adding && !/^\d{1,12}(\.\d{1,2})?$/.test(f.openingBalance.trim())) n.openingBalance = A.openingInvalid;
    setE(n);
    if (Object.keys(n).length) return void toast.error(Object.values(n)[0]!, { id: "account" });
    // Edit sends no balance at all; the server schema has no balance field for edits.
    const { openingBalance, ...details } = f;
    startTransition(async () => {
      let r: FinanceResult<AccountField>;
      try {
        r = adding ? await createAccount({ ...details, openingBalance: openingBalance.trim() }) : await updateAccount((modal as AccountRow).id, details);
      } catch {
        return void toast.error(T.common.somethingWrong, { id: "account" });
      }
      if (!r.ok) {
        if (r.fieldErrors) setE(r.fieldErrors);
        return void toast.error(r.message, { id: "account" });
      }
      toast.success(r.message, { id: "account" });
      setModal(null);
      setView(null);
      router.refresh();
    });
  }

  function toggle(a: AccountRow) {
    startTransition(async () => {
      try {
        const r = await setAccountStatus(a.id, a.status === "ACTIVE" ? "INACTIVE" : "ACTIVE");
        if (!r.ok) toast.error(r.message, { id: "account" });
        else toast.success(r.message, { id: "account" });
        setView(null);
        router.refresh();
      } catch {
        toast.error(T.common.somethingWrong, { id: "account" });
      }
    });
  }

  const menu = (a: AccountRow): RowMenuItem[] => [
    { label: A.viewDetails, icon: "eye", onClick: () => setView(a) },
    ...(canManage ? [{ label: A.editAccount, icon: "pencil", onClick: () => openEdit(a) } as RowMenuItem] : []),
    { label: A.viewTransactions, icon: "list", href: `/finance/transactions?account=${encodeURIComponent(a.id)}` },
    ...(canManage
      ? (["-", { label: a.status === "ACTIVE" ? A.deactivate : A.activate, icon: a.status === "ACTIVE" ? "ban" : "circle-check", danger: a.status === "ACTIVE", onClick: () => toggle(a) }] as RowMenuItem[])
      : []),
  ];
  const typeBadge = (t: AccountTypeValue) => <span className={`sp-badge sp-badge--${t === "CASH" ? "success" : "info"}`}>{X.type[t]}</span>;
  const statusBadge = (s: AccountStatusValue) => (
    <span className={`sp-badge sp-badge--${s === "ACTIVE" ? "success" : "neutral"}`} data-status={s}>
      <i />
      {X.status[s]}
    </span>
  );
  const editing = modal && modal !== "add" ? modal : null;
  const formCurrency = editing ? editing.currency : defaultCurrency;

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
                    {A.title}
</h1>
        {canManage && (
          <div style={{ display: "flex", gap: 12 }}>
            <button type="button" className="sp-btn sp-btn--primary" onClick={openAdd} disabled={!defaultCurrency} title={defaultCurrency ? undefined : A.noCurrencyTitle}>
                            <Icon name="plus" size={18} />
              {A.addNew}
            </button>
          </div>
        )}
      </div>
      <p className="t-body" style={{ margin: "-8px 0 24px", color: "var(--text-2)" }}>
                {A.subtitle}
</p>

      {!defaultCurrency && (
        <div className="sp-badge sp-badge--warning" role="status" data-testid="no-currency" style={{ height: "auto", padding: "10px 14px", whiteSpace: "normal", marginBottom: 24 }}>
          <Icon name="info" size={16} />
          <span>
                        {A.noCurrencyBanner}{" "}
            {canOpenSettings ? (
              <>
                                {A.chooseOne} <Link href="/settings">{A.systemSettings}</Link>.
              </>
            ) : (
              A.askOwner
            )}
          </span>
        </div>
      )}

      <div className="sp-kpi-grid bp-fin-kpis" style={{ marginBottom: 32 }}>
        <StatCard tone="green" icon="banknote" value={money(cash, defaultCurrency)} label={A.kpiCash} testId="kpi-cash" />
        <StatCard tone="blue" icon="landmark" value={money(bank, defaultCurrency)} label={A.kpiBank} testId="kpi-bank" />
        <StatCard tone="teal" icon="wallet" value={money(sum([cash, bank]), defaultCurrency)} label={A.kpiFunds} note={otherCurrency ? fmt(A.kpiFundsNoteOther, { n: otherCurrency }) : A.kpiFundsNote} testId="kpi-total" />
        <StatCard tone="violet" icon="circle-check" value={String(accounts.filter((a) => a.status === "ACTIVE").length)} label={A.kpiActive} testId="kpi-active" />
      </div>

      <div className="sp-toolbar">
        <div className="sp-group">
          <Icon name="search" size={18} className="sp-input-icon" />
          <input className="sp-input " placeholder={A.search} aria-label={A.search} value={q} onChange={(ev) => { setQ(ev.target.value); setPage(1); }} />
        </div>
        <div style={{ width: 170 }}>
          <select className="sp-select " aria-label={A.typeAria} value={ty} onChange={(ev) => { setTy(ev.target.value as typeof ty); setPage(1); }}>
            <option value="ALL">{A.allTypes}</option>
            <option value="CASH">{X.type.CASH}</option>
            <option value="BANK">{X.type.BANK}</option>
          </select>
        </div>
        <div style={{ width: 170 }}>
          <select className="sp-select " aria-label={A.statusAria} value={st} onChange={(ev) => { setSt(ev.target.value as typeof st); setPage(1); }}>
            <option value="ALL">{A.allStatuses}</option>
            <option value="ACTIVE">{X.status.ACTIVE}</option>
            <option value="INACTIVE">{X.status.INACTIVE}</option>
          </select>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="sp-card sp-empty" data-testid="accounts-empty">
          <Icon name="landmark" size={36} />
          <div className="t-section-title">{filtered ? A.emptyFiltered : A.emptyNone}</div>
          {filtered ? (
            <button type="button" className="sp-btn sp-btn--secondary" onClick={() => { setQ(""); setTy("ALL"); setSt("ALL"); }}>
                            {A.clear}
</button>
          ) : canManage ? (
            <button type="button" className="sp-btn sp-btn--primary" onClick={openAdd} disabled={!defaultCurrency}>
              <Icon name="plus" size={18} />
              {A.addNew}
            </button>
          ) : (
            <span>{A.emptyUser}</span>
          )}
        </div>
      ) : (
        <div className="sp-table-card">
          <div className="sp-table-scroll">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>{A.colName}</th>
                  <th>{A.colType}</th>
                  <th>{A.colRef}</th>
                  <th className="num">{A.colBalance}</th>
                  <th>{A.colStatus}</th>
                  <th className="act">{A.colAction}</th>
                </tr>
              </thead>
              <tbody>
                {p.visible.map((a) => (
                  <tr key={a.id} data-account={a.name}>
                    <td className="primary-cell">
                      <button type="button" onClick={() => setView(a)} style={{ display: "flex", alignItems: "center", gap: 12, background: "none", border: 0, padding: "4px 0", cursor: "pointer", font: "600 14px/20px var(--font-body)", color: "var(--primary-700)", textAlign: "left" }}>
                        <span style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", display: "grid", placeItems: "center", background: a.type === "CASH" ? "var(--success-50)" : "var(--primary-100)", color: a.type === "CASH" ? "var(--success-700)" : "var(--primary-700)" }}>
                          <Icon name={a.type === "CASH" ? "banknote" : "landmark"} size={18} />
                        </span>
                        {a.name}
                      </button>
                    </td>
                    <td>{typeBadge(a.type)}</td>
                    <td>{a.reference ? <span className="sp-code">{a.reference}</span> : "—"}</td>
                    <td className="num" data-testid="balance">
                      <b>{money(a.balance, a.currency)}</b>
                    </td>
                    <td>{statusBadge(a.status)}</td>
                    <td className="act">
                      <RowMenu label={a.name} items={menu(a)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={p.current} last={p.last} pageSize={size} from={p.from} to={p.to} total={p.total} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} />
        </div>
      )}

      {modal && canManage && (
        <Modal
          size="md"
          title={modal === "add" ? A.addNew : A.editAccount}
          onClose={() => !pending && setModal(null)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setModal(null)} disabled={pending}>
                {A.cancel}
</button>
              <button type="button" className="sp-btn sp-btn--primary" onClick={save} disabled={pending}>
                {pending ? A.saving : A.saveAccount}
              </button>
            </>
          }
        >
          <div className="sp-form-grid">
            <Field label={A.fName} required error={e.name} htmlFor="fa-name">
              <input id="fa-name" className="sp-input " placeholder={A.fNamePh} value={f.name} onChange={set("name")} />
            </Field>
            <Field label={A.fType} required htmlFor="fa-type">
              <select id="fa-type" className="sp-select " value={f.type} onChange={(ev) => { setF({ ...f, type: ev.target.value as AccountTypeValue }); setE({}); }}>
                <option value="CASH">{X.type.CASH}</option>
                <option value="BANK">{X.type.BANK}</option>
              </select>
            </Field>
            {f.type === "BANK" && (
              <Field label={A.fBank} required error={e.bankName} htmlFor="fa-bankName">
                <input id="fa-bankName" className="sp-input " placeholder={A.fBankPh} value={f.bankName} onChange={set("bankName")} />
              </Field>
            )}
            <Field label={f.type === "BANK" ? A.fAccountNumber : A.fReferenceOpt} required={f.type === "BANK"} error={e.reference} htmlFor="fa-reference">
              <input id="fa-reference" className="sp-input " placeholder={f.type === "BANK" ? A.fAccountNumberPh : A.fReferencePh} dir="ltr" value={f.reference} onChange={set("reference")} />
            </Field>
            {modal === "add" ? (
              <Field label={A.fOpening} required error={e.openingBalance} htmlFor="fa-openingBalance" hint={A.fOpeningHint}>
                <div className="sp-group">
                  <input id="fa-openingBalance" className="sp-input " inputMode="decimal" placeholder="0.00" value={f.openingBalance} onChange={set("openingBalance")} />
                  <span className="sp-addon sp-addon--r">{formCurrency?.symbol ?? "—"}</span>
                </div>
              </Field>
            ) : (
              <Field label={A.fCurrent} htmlFor="fa-balance" hint={A.fCurrentHint}>
                <input id="fa-balance" className="sp-input " value={editing ? money(editing.balance, editing.currency) : ""} readOnly disabled />
              </Field>
            )}
            <Field label={A.fCurrency} htmlFor="fa-currency" hint={modal === "add" ? A.fCurrencyHint : undefined}>
              <select id="fa-currency" className="sp-select " disabled value="cur">
                <option value="cur">{formCurrency ? `${formCurrency.code} – ${formCurrency.name}` : A.fNoCurrency}</option>
              </select>
            </Field>
            <Field label={A.fStatus} htmlFor="fa-status">
              <select id="fa-status" className="sp-select " value={f.status} onChange={set("status")}>
                <option value="ACTIVE">{X.status.ACTIVE}</option>
                <option value="INACTIVE">{X.status.INACTIVE}</option>
              </select>
            </Field>
            <div />
            <Field label={A.fNotes} htmlFor="fa-notes" className="sp-span-all">
              <textarea id="fa-notes" className="sp-textarea " rows={3} placeholder={A.fNotesPh} value={f.notes} onChange={set("notes")} />
            </Field>
          </div>
        </Modal>
      )}

      {view && (
        <Modal
          size="lg"
          title={view.name}
          onClose={() => setView(null)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setView(null)}>
                {A.detClose}
</button>
              {canManage && (
                <button type="button" className="sp-btn sp-btn--secondary" onClick={() => { const a = view; setView(null); openEdit(a); }}>
                                    <Icon name="pencil" size={18} />
                  {A.editAccount}
</button>
              )}
              <Link href={`/finance/transactions?account=${encodeURIComponent(view.id)}`} className="sp-btn sp-btn--primary">
                                <Icon name="list" size={18} />
                {A.viewTransactions}
</Link>
            </>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }} data-testid="account-details">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 16 }}>
              {(
                [
                  [A.detType, typeBadge(view.type)],
                  [A.detRef, view.reference ? <span className="sp-code">{view.reference}</span> : "—"],
                  [A.detBalance, <b key="b" style={{ fontSize: 18 }}>{money(view.balance, view.currency)}</b>],
                  [A.detStatus, statusBadge(view.status)],
                ] as const
              ).map(([l, v]) => (
                <div key={l}>
                  <div className="t-caption" style={{ marginBottom: 6 }}>
                    {l}
                  </div>
                  <div>{v}</div>
                </div>
              ))}
            </div>
            <div className="t-body" style={{ color: "var(--text-2)" }}>
              {view.bankName && (
                <div>
                  <b>{A.detBank}</b> <bdi dir="auto">{view.bankName}</bdi>
                </div>
              )}
              <div>
                <b>{A.detOpening}</b> {money(view.openingBalance, view.currency)} · <b>{A.detCurrency}</b> {view.currency.code}
              </div>
              {view.notes && <div>{view.notes}</div>}
            </div>
            <div>
              <h3 className="t-section-title" style={{ margin: "0 0 12px" }}>
                                {A.detRecent}
</h3>
              {view.recent.length === 0 ? (
                <div className="t-caption">{A.detNone}</div>
              ) : (
                <div className="sp-table-card" style={{ boxShadow: "none" }}>
                  <table className="sp-table">
                    <thead>
                      <tr>
                        <th>{A.detDate}</th>
                        <th>{A.detDescription}</th>
                        <th>{A.detReference}</th>
                        <th>{A.detTypeCol}</th>
                        <th className="num">{A.detAmount}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.recent.map((t) => (
                        <tr key={t.reference}>
                          <td>{t.date}</td>
                          <td className="primary-cell">{t.description}</td>
                          <td>
                            <span className="sp-code">{t.reference}</span>
                          </td>
                          <td>
                            <span className={`sp-badge sp-badge--${t.direction === "in" ? "success" : "danger"}`}>{t.direction === "in" ? A.moneyIn : A.moneyOut}</span>
                          </td>
                          <td className="num" style={{ color: t.direction === "in" ? "var(--success-700)" : "var(--danger-500)" }}>
                            {t.direction === "in" ? "+ " : "− "}
                            {money(t.amount, view.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export function Field({ label, required, error, hint, htmlFor, className, children }: { label: string; required?: boolean; error?: string; hint?: string; htmlFor: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={"sp-field" + (className ? " " + className : "") + (error ? " sp-field--error" : "")}>
      <label className="sp-label" htmlFor={htmlFor}>
        {label}
        {required && <i>*</i>}
      </label>
      {children}
      {error ? <span className="sp-error" id={`${htmlFor}-error`}>{error}</span> : hint ? <span className="sp-hint">{hint}</span> : null}
    </div>
  );
}
