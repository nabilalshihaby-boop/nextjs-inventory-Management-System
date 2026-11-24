import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getCashFlow, getCashFlowCurrencies, parseCfParams, resolveCfCurrency, type CfQueryError } from "@/lib/cash-flow";
import { formatDateOnly } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { getReportCompany } from "@/lib/report-company";
import { canViewCashFlow } from "@/lib/roles";
import { toUnits } from "@/lib/transfers";
import { fmt } from "@/lib/i18n/config";
import { getLocaleInfo } from "@/lib/i18n/server";
import ReportActions from "@/components/reports/ReportActions";
import ReportDocument, { ReportSummary } from "@/components/reports/ReportDocument";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLocaleInfo()).dict.cashFlow.reportTitle };
}

export const instant = false;

// Printable Cash Flow Statement (opened by "View Report"). OWNER/ADMIN only — anyone else is redirected before any figure or ledger
// row is read. The URL carries only the filters; every number is recomputed on the server from the persisted Cash & Bank ledger
// (lib/cash-flow.ts). One currency per report, never combined. Read-only: nothing is written. Every row of the period is rendered
// (no pagination) and the page prints without any app chrome.
export default async function CashFlowReportPage({ searchParams }: PageProps<"/reports/cash-flow">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canViewCashFlow(session.user)) redirect("/dashboard");

  const { dict: T } = await getLocaleInfo();
  const C = T.cashFlow;
  const sp = await searchParams;
  const back = `/cash-flow?${new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString()}`;
  const fail = (error: CfQueryError) => (
    <>
      <ReportActions backHref={back} backLabel={C.backToFilters} />
      <div className="sp-card sp-empty" data-testid="report-none">
        <span>{C.err[error]}</span>
      </div>
    </>
  );

  const q = parseCfParams(sp);
  if (!q.ok) return fail(q.error);
  const active = await getCashFlowCurrencies();
  const cur = resolveCfCurrency(q.p.currencyId, active.currencies);
  if (!cur.ok) return fail(cur.error);

  const [data, { company, generatedAt, dateFormat }, creator] = await Promise.all([
    getCashFlow({ ...q.p, currency: cur.currency, iconRight: active.iconRight }),
    getReportCompany(),
    db.user.findUnique({ where: { id: session.user.id }, select: { firstName: true, lastName: true } }),
  ]);

  const money = (v: string) => formatMoney(v.replace(/^-/, ""), data.currency);
  // Amounts are always shown LTR; negatives (and deductions) in parentheses.
  const amt = (v: string, opts: { deduct?: boolean } = {}) => {
    const neg = v.startsWith("-") !== !!opts.deduct && v.replace(/[-0.]/g, "") !== "";
    return <bdi dir="ltr">{neg ? `(${money(v)})` : money(v)}</bdi>;
  };
  const plain = (v: string) => (toUnits(v, 2) < BigInt(0) ? `(${money(v)})` : money(v));
  const day = (iso: string) => formatDateOnly(new Date(`${iso}T00:00:00.000Z`), dateFormat);
  const purposeLabel = (p: string | null) => (p ? ((T.finance.purposes as Record<string, string>)[p] ?? p) : C.detail.noPurpose);
  const row = (cls: string, label: string, value: ReactNode, key?: string) => (
    <tr className={cls} key={key ?? label}>
      <td>{label}</td>
      <td className="num">{value}</td>
    </tr>
  );
  const X = C.row;

  return (
    <>
      <ReportActions backHref={back} backLabel={C.backToFilters} />
      <ReportDocument
        title={C.reportTitle}
        company={company}
        generatedAt={generatedAt}
        generatedBy={creator ? `${creator.firstName} ${creator.lastName}` : undefined}
        orientation="landscape"
        testId="report-cash-flow"
        meta={[
          { label: C.meta.period, value: <bdi dir="ltr">{`${day(data.from)} – ${day(data.to)}`}</bdi> },
          { label: C.meta.currency, value: <bdi dir="ltr">{`${data.currency.code} (${data.currency.symbol})`}</bdi> },
          { label: C.meta.method, value: C.meta.methodValue },
          { label: C.meta.accounts, value: fmt(C.meta.accountsValue, { total: data.accounts.total, inactive: data.accounts.inactive }) },
        ]}
      >
        <ReportSummary
          testId="report-summary"
          items={[
            { label: C.cards.opening, value: plain(data.opening) },
            { label: C.cards.operating, value: plain(data.operatingNet) },
            ...(data.hasUnclassified ? [{ label: C.cards.unclassified, value: plain(data.unclassifiedNet) }] : []),
            { label: C.cards.netChange, value: plain(data.netChange) },
            { label: C.cards.closing, value: plain(data.closing), strong: true },
          ]}
        />

        <div className={data.reconciled ? "bp-report-note" : "bp-pl-alert"} role={data.reconciled ? undefined : "alert"} data-testid="cf-reconcile" style={{ marginBottom: 12 }}>
          {data.reconciled ? C.reconcile.ok : C.reconcile.bad}
        </div>

        <table className="bp-report-table bp-pl" data-testid="cf-statement">
          <thead>
            <tr>
              <th>{C.col.item}</th>
              <th className="num">{C.col.amount}</th>
            </tr>
          </thead>
          <tbody>
            {row("is-total", X.opening, amt(data.opening), "open")}
            {row("is-section", X.operatingSection, "", "s1")}
            {row("ind", X.customerCollections, amt(data.customerCollections), "cc")}
            {row("ind", X.supplierPayments, amt(data.supplierPayments, { deduct: true }), "sp")}
            {row("ind", X.operatingExpenses, amt(data.operatingExpenses, { deduct: true }), "oe")}
            {row("ind", X.expenseReversals, amt(data.expenseReversals), "er")}
            {row("is-total", X.operatingNet, amt(data.operatingNet), "on")}
            {data.hasUnclassified && (
              <>
                {row("is-section", X.unclassifiedSection, "", "s2")}
                {row("ind", X.unclassifiedIn, amt(data.unclassifiedIn), "ui")}
                {row("ind", X.unclassifiedOut, amt(data.unclassifiedOut, { deduct: true }), "uo")}
                {row("is-total", X.unclassifiedNet, amt(data.unclassifiedNet), "un")}
                <tr className="is-muted" data-testid="cf-unclassified-note">
                  <td colSpan={2}>{X.unclassifiedNote}</td>
                </tr>
              </>
            )}
            {row("is-total", X.netChange, amt(data.netChange), "nc")}
            {row("is-total is-final", X.closing, amt(data.closing), "close")}
          </tbody>
          {data.internal.count > 0 && (
            <tfoot data-testid="cf-internal">
              <tr>
                <td colSpan={2}>{X.internalSection}</td>
              </tr>
              <tr className="is-info">
                <td>{X.internalTransfers}</td>
                <td className="num">{amt(data.internal.transfers)}</td>
              </tr>
              <tr className="is-info">
                <td>{X.registerIn}</td>
                <td className="num">{amt(data.internal.registerIn)}</td>
              </tr>
              <tr className="is-info">
                <td>{X.registerOut}</td>
                <td className="num">{amt(data.internal.registerOut)}</td>
              </tr>
              <tr className="is-info">
                <td colSpan={2}>{X.internalNote}</td>
              </tr>
            </tfoot>
          )}
        </table>

        <h2 className="t-section-title" style={{ margin: "18px 0 8px", fontSize: 14 }}>
          {C.detail.title}
        </h2>
        {data.empty ? (
          <div className="bp-report-empty" data-testid="report-empty">
            {C.empty}
          </div>
        ) : (
          <table className="bp-report-table" data-testid="cf-detail">
            <thead>
              <tr>
                <th>{C.detail.cols.date}</th>
                <th>{C.detail.cols.reference}</th>
                <th>{C.detail.cols.account}</th>
                <th>{C.detail.cols.source}</th>
                <th>{C.detail.cols.category}</th>
                <th className="num">{C.detail.cols.cashIn}</th>
                <th className="num">{C.detail.cols.cashOut}</th>
                <th className="num">{C.detail.cols.balance}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className={r.internal ? "is-muted" : undefined} data-category={r.category} data-ref={r.reference}>
                  <td>
                    <bdi dir="ltr">{day(r.date)}</bdi>
                  </td>
                  <td>
                    {r.expenseId ? (
                      <Link href={`/expenses/${r.expenseId}/edit`}>
                        <bdi dir="ltr">{r.reference}</bdi>
                      </Link>
                    ) : (
                      <bdi dir="ltr">{r.reference}</bdi>
                    )}
                  </td>
                  <td>{r.account}</td>
                  <td>
                    {purposeLabel(r.purpose)}
                    {r.pos && ` · ${C.detail.pos}`}
                    {r.note && <span className="bp-report-muted" style={{ display: "block" }}>{r.note}</span>}
                  </td>
                  <td>
                    {C.detail.cat[r.category]}
                    {r.internal && <span className="bp-report-muted" style={{ display: "block" }}>{C.detail.internalTag}{" · "}<bdi dir="ltr">{money(r.internalAmount)}</bdi></span>}
                  </td>
                  <td className="num">{r.cashIn && <bdi dir="ltr">{money(r.cashIn)}</bdi>}</td>
                  <td className="num">{r.cashOut && <bdi dir="ltr">{money(r.cashOut)}</bdi>}</td>
                  <td className="num">{amt(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <section className="bp-report-note bp-keep" data-testid="cf-notes">
          <b>{C.notes.title}</b>
          <ol style={{ margin: "4px 0 0", paddingInlineStart: 18 }}>
            {[C.notes.n1, C.notes.n2, C.notes.n3, C.notes.n4, C.notes.n5, C.notes.n6].map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </section>
      </ReportDocument>
    </>
  );
}
