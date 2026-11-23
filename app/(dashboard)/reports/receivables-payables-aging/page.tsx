import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { BUCKETS } from "@/lib/aging-core";
import { getAging, getAgingCurrencies, parseAgingParams, resolveAgingCurrency, resolveAgingFilters, type AgingQueryError, type SectionView } from "@/lib/aging";
import { formatDateOnly } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { getReportCompany } from "@/lib/report-company";
import { canViewAging } from "@/lib/roles";
import { fmt } from "@/lib/i18n/config";
import { getLocaleInfo } from "@/lib/i18n/server";
import ReportActions from "@/components/reports/ReportActions";
import ReportDocument, { ReportSummary } from "@/components/reports/ReportDocument";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLocaleInfo()).dict.aging.reportTitle };
}

export const instant = false;

// Printable Receivables & Payables Aging report (opened by "View Report"). OWNER/ADMIN only — anyone else is redirected before any
// figure is read. Every parameter is validated on the server; the URL never decides anything on its own. Each outstanding document is
// aged from its own invoice date, as of the requested date, using only returns and payment ALLOCATIONS dated on or before it.
// One currency per report; Receivables and Payables are separate sections and are never netted. Read-only: nothing is written.
export default async function AgingReportPage({ searchParams }: PageProps<"/reports/receivables-payables-aging">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canViewAging(session.user.role)) redirect("/dashboard");

  const { dict: T } = await getLocaleInfo();
  const A = T.aging;
  const sp = await searchParams;
  const back = `/receivables-payables-aging?${new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString()}`;
  const fail = (error: AgingQueryError) => (
    <>
      <ReportActions backHref={back} backLabel={A.backToFilters} />
      <div className="sp-card sp-empty" data-testid="report-none">
        <span>{A.err[error]}</span>
      </div>
    </>
  );

  const q = parseAgingParams(sp);
  if (!q.ok) return fail(q.error);
  const active = await getAgingCurrencies(q.p.type);
  const cur = resolveAgingCurrency(q.p.currencyId, active.currencies);
  if (!cur.ok) return fail(cur.error);
  const filters = await resolveAgingFilters(q.p);
  if (!filters.ok) return fail(filters.error);

  const [data, { company, generatedAt, dateFormat }, creator] = await Promise.all([
    getAging({ ...q.p, currency: cur.currency, iconRight: active.iconRight, customer: filters.customer, supplier: filters.supplier }),
    getReportCompany(),
    db.user.findUnique({ where: { id: session.user.id }, select: { firstName: true, lastName: true } }),
  ]);

  const money = (v: string) => formatMoney(v, data.currency);
  const day = (iso: string) => formatDateOnly(new Date(`${iso}T00:00:00.000Z`), dateFormat);
  const m = (v: string) => <bdi dir="ltr">{money(v)}</bdi>;

  const section = (kind: "receivables" | "payables", s: SectionView) => {
    const ar = kind === "receivables";
    const statement = (id: string) => (ar ? `/customers/statement?customer=${encodeURIComponent(id)}&currency=${encodeURIComponent(data.currency.id)}` : `/suppliers/statement?supplier=${encodeURIComponent(id)}&currency=${encodeURIComponent(data.currency.id)}`);
    return (
      <section key={kind} data-testid={`ag-${kind}`} style={{ marginBottom: 20 }}>
        <h2 className="t-section-title" style={{ margin: "14px 0 8px", fontSize: 15 }}>
          {A.section[kind]}
        </h2>
        <ReportSummary
          testId={`ag-${kind}-summary`}
          items={[
            { label: A.cards.total, value: money(s.totals.outstanding), strong: true },
            ...BUCKETS.map((b) => ({ label: A.bucket[b], value: money(s.totals.buckets[b]) })),
          ]}
        />
        {s.groups.length === 0 ? (
          <div className="bp-report-empty" data-testid={`ag-${kind}-empty`}>
            {ar ? A.emptyReceivables : A.emptyPayables}
          </div>
        ) : (
          <>
            <div className={s.reconciled ? "bp-report-note" : "bp-pl-alert"} role={s.reconciled ? undefined : "alert"} data-testid={`ag-${kind}-reconcile`} style={{ marginBottom: 6 }}>
              {s.reconciled ? A.reconcile.ok : A.reconcile.bad}
            </div>
            <table className="bp-report-table bp-pl" data-testid={`ag-${kind}-table`}>
              <thead>
                <tr>
                  <th>{A.cols.invoice}</th>
                  <th>{A.cols.date}</th>
                  <th className="num">{A.cols.days}</th>
                  <th className="num">{A.cols.total}</th>
                  <th className="num">{A.cols.returns}</th>
                  <th className="num">{A.cols.payments}</th>
                  <th className="num">{A.cols.outstanding}</th>
                  <th>{A.cols.bucket}</th>
                </tr>
              </thead>
                {s.groups.map((g) => (
                  <tbody key={`g-${g.partyId}`} className="bp-ag-group">
                    {[
                      <tr key={`h-${g.partyId}`} className="is-section" data-party={g.partyId}>
                        <td colSpan={8}>
                          <Link href={statement(g.partyId)} title={A.statementLink}>
                            {g.partyName}
                          </Link>
                        </td>
                      </tr>,
                      ...g.rows.map((r) => (
                        <tr key={r.id} data-ref={r.reference} data-bucket={r.bucket} data-days={r.days}>
                          <td>
                            <Link href={ar ? `/sales/${encodeURIComponent(r.id)}` : `/purchases/${encodeURIComponent(r.id)}`}>
                              <bdi dir="ltr">{r.reference}</bdi>
                            </Link>
                            {r.status && <span className="bp-report-muted" style={{ display: "block" }}>{(T.purchases.status as Record<string, string>)[r.status] ?? r.status}</span>}
                          </td>
                          <td>
                            <bdi dir="ltr">{day(r.date)}</bdi>
                          </td>
                          <td className="num">
                            <bdi dir="ltr">{r.days}</bdi>
                          </td>
                          <td className="num">{m(r.total)}</td>
                          <td className="num">{m(r.returns)}</td>
                          <td className="num">{m(r.payments)}</td>
                          <td className="num">
                            <b>{m(r.outstanding)}</b>
                          </td>
                          <td>{A.bucket[r.bucket]}</td>
                        </tr>
                      )),
                      <tr key={`s-${g.partyId}`} className="is-total" data-subtotal={g.partyId}>
                        <td colSpan={3}>{fmt(A.subtotal, { name: g.partyName })}</td>
                        <td className="num">{m(g.sub.total)}</td>
                        <td className="num">{m(g.sub.returns)}</td>
                        <td className="num">{m(g.sub.payments)}</td>
                        <td className="num">{m(g.sub.outstanding)}</td>
                        <td />
                      </tr>,
                    ]}
                  </tbody>
                ))}
                <tbody>
                <tr className="is-total is-final" data-testid={`ag-${kind}-total`}>
                  <td colSpan={3}>{A.reportTotal}</td>
                  <td className="num">{m(s.totals.total)}</td>
                  <td className="num">{m(s.totals.returns)}</td>
                  <td className="num">{m(s.totals.payments)}</td>
                  <td className="num">{m(s.totals.outstanding)}</td>
                  <td />
                </tr>
                </tbody>
            </table>
          </>
        )}
      </section>
    );
  };

  return (
    <>
      <ReportActions backHref={back} backLabel={A.backToFilters} />
      <ReportDocument
        title={A.reportTitle}
        company={company}
        generatedAt={generatedAt}
        generatedBy={creator ? `${creator.firstName} ${creator.lastName}` : undefined}
        orientation="landscape"
        testId="report-aging"
        meta={[
          { label: A.meta.asOf, value: <bdi dir="ltr">{day(data.asOf)}</bdi> },
          { label: A.meta.type, value: A.types[data.type] },
          { label: A.meta.currency, value: <bdi dir="ltr">{`${data.currency.code} (${data.currency.symbol})`}</bdi> },
          ...(data.customer ? [{ label: A.meta.customer, value: data.customer.name }] : []),
          ...(data.supplier ? [{ label: A.meta.supplier, value: data.supplier.name }] : []),
          { label: A.meta.basis, value: A.meta.basisValue },
        ]}
      >
        {data.receivables && section("receivables", data.receivables)}
        {data.payables && section("payables", data.payables)}

        <section className="bp-report-note bp-keep" data-testid="ag-notes">
          <b>{A.notes.title}</b>
          <ol style={{ margin: "4px 0 0", paddingInlineStart: 18 }}>
            {[A.notes.n1, A.notes.n2, A.notes.n3, A.notes.n4, A.notes.n5, A.notes.n6].map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </section>
      </ReportDocument>
    </>
  );
}
