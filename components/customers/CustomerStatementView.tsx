"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/layout/Icon";
import Pagination, { paginate } from "@/components/ui/Pagination";
import StatCard from "@/components/ui/StatCard";
import { formatMoney } from "@/lib/money";
import { fromUnits, toUnits } from "@/lib/transfers";
import { CUSTOMER_KIND_TONE, statementRangeKey, type CustomerStatement } from "@/lib/customer-statement";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import { tr } from "@/lib/i18n/messages";

// Port of design/Customer Statement.html (same structure as the Supplier Statement): PageHeader
// ("Customer Account Statement · name", Back, Record Customer Payment), filter card (Customer /
// From Date / To Date / Generate Report), KPI cards (Total Sales, Total Paid, Outstanding Balance),
// TableToolbar (search, and "View Report" in place of the design's direct Print) and the ledger
// table with totals footer and Pagination. Generate Report reloads from the server (URL params);
// search/paging only filter the rows already computed there. Additions for real data: Sales
// Returns (credits), an Opening Balance row, and a Currency selector when the customer has records
// in several currencies (balances are never mixed across currencies).

type Data = { statement: CustomerStatement; customers: { id: string; name: string }[]; notice: string | null } | null;

export default function CustomerStatementView({ data, today }: { data: Data; today: string }) {
  const router = useRouter();
  const T = useT();
  const M = T.stmt;
  const s = data?.statement;
  const [f, setF] = useState({ customer: s?.customer?.id ?? "", from: s?.from ?? "", to: s?.to ?? "", currency: s?.currency?.id ?? "" });
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);

  const header = (name: string, extra?: ReactNode) => (
    <div className="sp-page-head">
      <h1 className="t-page-title" style={{ margin: 0 }}>
        {M.title}{name ? ` · ${name}` : ""}
      </h1>
      <div className="sp-noprint" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link href="/customers" className="sp-btn sp-btn--secondary">
          <Icon name="arrow-left" size={18} />
          {M.back}
        </Link>
        {extra}
      </div>
    </div>
  );

  if (!data || !s) {
    return (
      <>
        {header("")}
        <div className="sp-card sp-empty" data-testid="st-setup">
          <Icon name="inbox" size={36} />
          <div className="t-section-title">{M.setupTitle}</div>
          <span>{M.setupBody}</span>
          <Link href="/customers/create" className="sp-btn sp-btn--secondary">
            {M.addCustomer}
          </Link>
        </div>
      </>
    );
  }

  const customer = s.customer;
  const cur = s.currency;
  const money = (v: string) => formatMoney(v, cur);
  const opening = s.opening !== "0.00";
  const needle = q.trim().toLowerCase();
  const rows = needle ? s.rows.filter((r) => [r.reference, r.description, M.kind[r.kind]].join(" ").toLowerCase().includes(needle)) : s.rows;
  const p = paginate(rows, page, size);
  const reportQuery = customer ? new URLSearchParams({ customer: customer.id, from: s.from, to: s.to, ...(cur && s.currencies.length > 1 ? { currency: cur.id } : {}) }) : null;

  function generate() {
    if (!f.customer) return setErr(M.errChooseCustomer);
    // Dates are both-or-neither: blank means "this customer's full history up to today".
    if (f.from || f.to) {
      const e = statementRangeKey(f.from, f.to);
      if (e) return setErr(tr(T, e));
      if (f.to > today) return setErr(M.errToFuture);
    }
    setErr("");
    setPage(1);
    setQ("");
    const sp = new URLSearchParams({ customer: f.customer });
    if (f.from && f.to) {
      sp.set("from", f.from);
      sp.set("to", f.to);
    }
    if (f.currency && customer && f.customer === customer.id && s!.currencies.length > 1) sp.set("currency", f.currency);
    router.push(`/customers/statement?${sp.toString()}`);
  }

  return (
    <>
      {header(
        customer?.name ?? "",
        <Link href={customer ? `/customer-payments/record?customer=${encodeURIComponent(customer.id)}` : "/customer-payments/record"} className="sp-btn sp-btn--primary">
          <Icon name="plus" size={18} />
          {M.record}
        </Link>,
      )}

      {data.notice && (
        <div className="sp-card sp-noprint" role="status" data-testid="st-notice" style={{ padding: "12px 16px", marginBottom: 16, color: "var(--warning-700, var(--text-1))" }}>
          {data.notice}
        </div>
      )}

      <form
        className="sp-card sp-noprint"
        style={{ padding: 24, marginBottom: 24 }}
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          generate();
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: s.currencies.length > 1 ? "repeat(4,minmax(0,1fr)) auto" : "repeat(3,minmax(0,1fr)) auto", gap: 24, alignItems: "end" }}>
          <div className="sp-field">
            <label className="sp-label" htmlFor="st-customer">
              {M.customer}<i>*</i>
            </label>
            <select id="st-customer" className="sp-select " value={f.customer} onChange={(ev) => setF({ ...f, customer: ev.target.value, from: ev.target.value === customer?.id ? s.from : "", to: ev.target.value === customer?.id ? s.to : "" })}>
              <option value="">{M.selectCustomerOpt}</option>
              {data.customers.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sp-field">
            <label className="sp-label" htmlFor="st-from">
              {M.from}<i>*</i>
            </label>
            <input id="st-from" type="date" className="sp-input " max={today} value={f.from} onChange={(ev) => setF({ ...f, from: ev.target.value })} />
          </div>
          <div className="sp-field">
            <label className="sp-label" htmlFor="st-to">
              {M.to}<i>*</i>
            </label>
            <input id="st-to" type="date" className="sp-input " max={today} value={f.to} onChange={(ev) => setF({ ...f, to: ev.target.value })} />
          </div>
          {s.currencies.length > 1 && (
            <div className="sp-field">
              <label className="sp-label" htmlFor="st-currency">
                {M.currency}
              </label>
              <select id="st-currency" className="sp-select " value={f.currency} disabled={f.customer !== customer?.id} onChange={(ev) => setF({ ...f, currency: ev.target.value })}>
                {s.currencies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button type="submit" className="sp-btn sp-btn--primary">
            <Icon name="chart-column" size={18} />
            {M.generate}
          </button>
        </div>
        {err && (
          <div className="sp-error" style={{ marginTop: 12 }} data-testid="st-error">
            {err}
          </div>
        )}
      </form>

      {!customer ? (
        <div className="sp-card sp-empty" data-testid="st-select">
          <Icon name="file-text" size={36} />
          <div className="t-section-title">{M.selectTitle}</div>
          <span>{M.selectBody}</span>
        </div>
      ) : (
        <>
          <p className="t-caption" data-testid="st-period" style={{ margin: "0 0 16px" }}>
            {customer.name} · {s.fromLabel} – {s.toLabel}
            {cur ? ` · ${cur.code}` : ""}
          </p>

          <div className="sp-kpi-grid" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))", marginBottom: 32 }}>
            <StatCard tone="green" icon="shopping-cart" value={money(s.totalSales)} label={M.kpiSales} note={s.totalReturns !== "0.00" ? fmt(M.kpiReturns, { amount: money(s.totalReturns) }) : undefined} testId="kpi-sales" />
            <StatCard tone="blue" icon="banknote" value={money(s.totalPaid)} label={M.kpiPaid} testId="kpi-paid" />
            <StatCard
              tone="red"
              icon="circle-minus"
              value={money(s.closing)}
              label={M.kpiOutstanding}
              note={opening ? fmt(M.kpiOpeningNote, { amount: money(s.opening) }) : M.kpiFormulaNote}
              testId="kpi-outstanding"
            />
          </div>

          <div className="sp-toolbar sp-noprint">
            <div className="sp-group">
              <Icon name="search" size={18} className="sp-input-icon" />
              <input className="sp-input " placeholder={M.search} aria-label={M.search} value={q} onChange={(ev) => { setQ(ev.target.value); setPage(1); }} />
            </div>
            <div className="sp-grow" />
            {/* The full statement of the APPLIED filters (all rows, not just this page) as a printable report. */}
            <Link href={`/reports/customer-statement?${reportQuery!.toString()}`} className="sp-btn sp-btn--secondary" data-testid="view-report">
              <Icon name="file-text" size={18} />
              {M.viewReport}
            </Link>
          </div>

          {s.rows.length === 0 && !opening ? (
            <div className="sp-card sp-empty" data-testid="st-empty">
              <Icon name="inbox" size={36} />
              <div className="t-section-title">{M.emptyPeriod}</div>
            </div>
          ) : (
            <div className="sp-table-card">
              <div className="sp-table-scroll">
                <table className="sp-table" data-testid="st-table">
                  <thead>
                    <tr>
                      <th>{M.colDate}</th>
                      <th>{M.colReference}</th>
                      <th>{M.colType}</th>
                      <th>{M.colDescription}</th>
                      <th className="num">{M.colDebit}</th>
                      <th className="num">{M.colCredit}</th>
                      <th className="num">{M.colRunning}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opening && p.current === 1 && !needle && (
                      <tr data-testid="st-opening">
                        <td>{s.fromLabel}</td>
                        <td>—</td>
                        <td>
                          <span className="sp-badge sp-badge--neutral">{M.opening}</span>
                        </td>
                        <td className="primary-cell">{fmt(M.openingDesc, { date: s.fromLabel })}</td>
                        <td className="num">—</td>
                        <td className="num">—</td>
                        <td className="num">
                          <b>{money(s.opening)}</b>
                        </td>
                      </tr>
                    )}
                    {p.visible.map((r) => (
                      <tr key={r.key} data-ref={r.reference}>
                        <td>{r.dateLabel}</td>
                        <td>
                          <Link href={r.href} className="sp-code">
                            {r.reference}
                          </Link>
                        </td>
                        <td>
                          <span className={`sp-badge sp-badge--${CUSTOMER_KIND_TONE[r.kind]}`} data-kind={r.kind}>
                            {M.kind[r.kind]}
                          </span>
                        </td>
                        <td className="primary-cell">{r.description}</td>
                        <td className="num" data-col="debit">{r.debit ? money(r.debit) : "—"}</td>
                        <td className="num" data-col="credit">{r.credit ? money(r.credit) : "—"}</td>
                        <td className="num" data-col="balance">
                          <b>{money(r.balance)}</b>
                        </td>
                      </tr>
                    ))}
                    {p.visible.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: "center", color: "var(--text-2)" }} data-testid="st-nomatch">
                          {s.rows.length ? M.noMatch : M.noPeriod}
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr data-testid="st-totals" style={{ fontWeight: 700 }}>
                      <td colSpan={4}>{M.total}</td>
                      <td className="num" data-col="debit">{money(s.totalSales)}</td>
                      <td className="num" data-col="credit">{money(fromUnits(toUnits(s.totalReturns, 2) + toUnits(s.totalPaid, 2), 2))}</td>
                      <td className="num" data-col="balance">{money(s.closing)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="sp-noprint">
                <Pagination page={p.current} last={p.last} pageSize={size} from={p.from} to={p.to} total={p.total} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} />
              </div>
            </div>
          )}
          <p className="t-caption" style={{ marginTop: 12 }}>
            {M.footnote}
          </p>
        </>
      )}
    </>
  );
}
