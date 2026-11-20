"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/layout/Icon";
import Pagination, { paginate } from "@/components/ui/Pagination";
import StatCard from "@/components/ui/StatCard";
import { formatMoney } from "@/lib/money";
import { fromUnits, toUnits } from "@/lib/transfers";
import { STATEMENT_KIND_LABEL, STATEMENT_KIND_TONE, statementRangeError, type SupplierStatement } from "@/lib/supplier-statement";

// Port of design/Supplier Statement.html: PageHeader ("Supplier Account Statement · name", Back,
// Record Supplier Payment), the filter card (Supplier / From Date / To Date / Generate Report),
// three KPI cards (Total Purchases, Total Paid, Outstanding Balance), TableToolbar (search, and
// "View Report" in place of the design's direct Print — it opens /reports/supplier-statement)
// and the ledger DataTable (Date / Reference / Transaction Type / Description / Debit / Credit /
// Running Balance) with a totals footer and Pagination. Generate Report reloads the statement from
// the server (URL parameters); search and paging only filter the rows already computed there.
// Additions for real data: purchase returns are debits too, an "Opening balance" row when the
// period doesn't start at the first record, and a Currency selector when the supplier has records
// in more than one currency (balances are never mixed across currencies).

type Data = { statement: SupplierStatement; suppliers: { id: string; name: string }[]; notice: string | null } | null;

export default function SupplierStatementView({ data, today }: { data: Data; today: string }) {
  const router = useRouter();
  const s = data?.statement;
  const [f, setF] = useState({ supplier: s?.supplier.id ?? "", from: s?.from ?? "", to: s?.to ?? "", currency: s?.currency?.id ?? "" });
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);

  const header = (name: string, extra?: ReactNode) => (
    <div className="sp-page-head">
      <h1 className="t-page-title" style={{ margin: 0 }}>
        Supplier Account Statement{name ? ` · ${name}` : ""}
      </h1>
      <div className="sp-noprint" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link href="/suppliers" className="sp-btn sp-btn--secondary">
          <Icon name="arrow-left" size={18} />
          Back
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
          <div className="t-section-title">No suppliers yet</div>
          <span>Add a supplier and record purchases to see its account statement.</span>
          <Link href="/suppliers/create" className="sp-btn sp-btn--secondary">
            Add Supplier
          </Link>
        </div>
      </>
    );
  }

  const cur = s.currency;
  const money = (v: string) => formatMoney(v, cur);
  const opening = s.opening !== "0.00";
  const needle = q.trim().toLowerCase();
  const rows = needle ? s.rows.filter((r) => [r.reference, r.description, STATEMENT_KIND_LABEL[r.kind]].join(" ").toLowerCase().includes(needle)) : s.rows;
  const p = paginate(rows, page, size);
  const reportQuery = new URLSearchParams({ supplier: s.supplier.id, from: s.from, to: s.to, ...(cur && s.currencies.length > 1 ? { currency: cur.id } : {}) });

  function generate() {
    if (!f.supplier) return setErr("Choose a supplier");
    const e = statementRangeError(f.from, f.to);
    if (e) return setErr(e);
    if (f.to > today) return setErr("To Date can't be in the future");
    setErr("");
    setPage(1);
    setQ("");
    const sp = new URLSearchParams({ supplier: f.supplier, from: f.from, to: f.to });
    if (f.currency && f.supplier === s!.supplier.id && s!.currencies.length > 1) sp.set("currency", f.currency);
    router.push(`/suppliers/statement?${sp.toString()}`);
  }

  return (
    <>
      {header(
        s.supplier.name,
        <Link href={`/supplier-payments/record?supplier=${encodeURIComponent(s.supplier.id)}`} className="sp-btn sp-btn--primary">
          <Icon name="plus" size={18} />
          Record Supplier Payment
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
            <label className="sp-label" htmlFor="st-supplier">
              Supplier<i>*</i>
            </label>
            <select id="st-supplier" className="sp-select " value={f.supplier} onChange={(ev) => setF({ ...f, supplier: ev.target.value })}>
              {data.suppliers.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sp-field">
            <label className="sp-label" htmlFor="st-from">
              From Date<i>*</i>
            </label>
            <input id="st-from" type="date" className="sp-input " max={today} value={f.from} onChange={(ev) => setF({ ...f, from: ev.target.value })} />
          </div>
          <div className="sp-field">
            <label className="sp-label" htmlFor="st-to">
              To Date<i>*</i>
            </label>
            <input id="st-to" type="date" className="sp-input " max={today} value={f.to} onChange={(ev) => setF({ ...f, to: ev.target.value })} />
          </div>
          {s.currencies.length > 1 && (
            <div className="sp-field">
              <label className="sp-label" htmlFor="st-currency">
                Currency
              </label>
              <select id="st-currency" className="sp-select " value={f.currency} disabled={f.supplier !== s.supplier.id} onChange={(ev) => setF({ ...f, currency: ev.target.value })}>
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
            Generate Report
          </button>
        </div>
        {err && (
          <div className="sp-error" style={{ marginTop: 12 }} data-testid="st-error">
            {err}
          </div>
        )}
      </form>

      <p className="t-caption" data-testid="st-period" style={{ margin: "0 0 16px" }}>
        {s.supplier.name} · {s.fromLabel} – {s.toLabel}
        {cur ? ` · ${cur.code}` : ""}
      </p>

      <div className="sp-kpi-grid" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))", marginBottom: 32 }}>
        <StatCard tone="green" icon="package-plus" value={money(s.totalPurchases)} label="Total Purchases" note={s.totalReturns !== "0.00" ? `Returns ${money(s.totalReturns)}` : undefined} testId="kpi-purchases" />
        <StatCard tone="blue" icon="banknote" value={money(s.totalPaid)} label="Total Paid" testId="kpi-paid" />
        <StatCard
          tone="red"
          icon="circle-minus"
          value={money(s.closing)}
          label="Outstanding Balance"
          note={opening ? `Includes opening balance ${money(s.opening)}` : "Purchases − Returns − Payments"}
          testId="kpi-outstanding"
        />
      </div>

      <div className="sp-toolbar sp-noprint">
        <div className="sp-group">
          <Icon name="search" size={18} className="sp-input-icon" />
          <input className="sp-input " placeholder="Search transactions" aria-label="Search transactions" value={q} onChange={(ev) => { setQ(ev.target.value); setPage(1); }} />
        </div>
        <div className="sp-grow" />
        {/* The full statement of the APPLIED filters (all rows, not just this page) as a printable report. */}
        <Link href={`/reports/supplier-statement?${reportQuery.toString()}`} className="sp-btn sp-btn--secondary" data-testid="view-report">
          <Icon name="file-text" size={18} />
          View Report
        </Link>
      </div>

      {s.rows.length === 0 && !opening ? (
        <div className="sp-card sp-empty" data-testid="st-empty">
          <Icon name="inbox" size={36} />
          <div className="t-section-title">No transactions in this period</div>
        </div>
      ) : (
        <div className="sp-table-card">
          <div className="sp-table-scroll">
            <table className="sp-table" data-testid="st-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Reference</th>
                  <th>Transaction Type</th>
                  <th>Description</th>
                  <th className="num">Debit</th>
                  <th className="num">Credit</th>
                  <th className="num">Running Balance</th>
                </tr>
              </thead>
              <tbody>
                {opening && p.current === 1 && !needle && (
                  <tr data-testid="st-opening">
                    <td>{s.fromLabel}</td>
                    <td>—</td>
                    <td>
                      <span className="sp-badge sp-badge--neutral">Opening</span>
                    </td>
                    <td className="primary-cell">Opening balance (before {s.fromLabel})</td>
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
                      <span className={`sp-badge sp-badge--${STATEMENT_KIND_TONE[r.kind]}`} data-kind={r.kind}>
                        {STATEMENT_KIND_LABEL[r.kind]}
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
                      {s.rows.length ? "No transactions match your search." : "No transactions in this period."}
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr data-testid="st-totals" style={{ fontWeight: 700 }}>
                  <td colSpan={4}>Total</td>
                  <td className="num" data-col="debit">{money(fromUnits(toUnits(s.totalReturns, 2) + toUnits(s.totalPaid, 2), 2))}</td>
                  <td className="num" data-col="credit">{money(s.totalPurchases)}</td>
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
        Credit increases the amount owed to the supplier (purchases). Debit reduces it (purchase returns and payments).
      </p>
    </>
  );
}

