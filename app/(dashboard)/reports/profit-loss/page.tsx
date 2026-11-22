import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatDateOnly, formatDateTime } from "@/lib/format";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { getActiveCurrencies, getProfitLoss, parsePlParams, resolveCurrency, type PlQueryError } from "@/lib/profit-loss";
import { getReportCompany } from "@/lib/report-company";
import { canSetCostBaseline, canViewProfitLoss } from "@/lib/roles";
import { toUnits } from "@/lib/transfers";
import { fmt } from "@/lib/i18n/config";
import { getLocaleInfo } from "@/lib/i18n/server";
import ReportActions from "@/components/reports/ReportActions";
import ReportDocument, { ReportSummary } from "@/components/reports/ReportDocument";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLocaleInfo()).dict.profitLoss.reportTitle };
}

export const instant = false;

// Printable Profit & Loss Statement (opened by "View Report"). OWNER/ADMIN only — anyone else is redirected before
// any figure or source record is read. The URL carries only the filters; every number is recomputed on the server
// from the saved documents (lib/profit-loss.ts). One currency per report, never combined. Read-only: nothing is
// written. The full statement is rendered (no pagination) and prints without any app chrome.
export default async function ProfitLossReportPage({ searchParams }: PageProps<"/reports/profit-loss">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canViewProfitLoss(session.user.role)) redirect("/dashboard");

  const { dict: T, locale } = await getLocaleInfo();
  const P = T.profitLoss;
  const sp = await searchParams;
  const back = `/profit-loss?${new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString()}`;
  const fail = (error: PlQueryError) => (
    <>
      <ReportActions backHref={back} backLabel={P.backToFilters} />
      <div className="sp-card sp-empty" data-testid="report-none">
        <span>{P.err[error]}</span>
      </div>
    </>
  );

  const q = parsePlParams(sp);
  if (!q.ok) return fail(q.error);
  const active = await getActiveCurrencies();
  const cur = resolveCurrency(q.p.currencyId, active.currencies);
  if (!cur.ok) return fail(cur.error);

  const [data, { company, generatedAt, dateFormat }, creator] = await Promise.all([
    getProfitLoss({ ...q.p, currency: cur.currency, iconRight: active.iconRight, defaultCurrencyId: active.defaultId }),
    getReportCompany(),
    db.user.findUnique({ where: { id: session.user.id }, select: { firstName: true, lastName: true } }),
  ]);

  const L = data.lines;
  const money = (v: string) => formatMoney(v.replace(/^-/, ""), data.currency);
  // Amounts are always shown LTR (codes, symbols and digits stay readable in Arabic); negatives in parentheses.
  const amt = (v: string | null, opts: { negate?: boolean } = {}) => {
    if (v === null) return <span className="bp-report-muted">{P.cards.unavailable}</span>;
    const neg = v.startsWith("-") !== !!opts.negate && v.replace(/[-0.]/g, "") !== "";
    return <bdi dir="ltr">{neg ? `(${money(v)})` : money(v)}</bdi>;
  };
  const day = (iso: string) => formatDateOnly(new Date(`${iso}T00:00:00.000Z`), dateFormat);
  // Gross margin in exact BigInt tenths of a percent (truncated), e.g. 4250 / 1000 -> "42.5%".
  const margin = (() => {
    if (L.grossProfit === null || toUnits(L.netSales, 2) <= BigInt(0)) return null;
    const t = (toUnits(L.grossProfit, 2) * BigInt(1000)) / toUnits(L.netSales, 2);
    const a = t < BigInt(0) ? -t : t;
    return `${t < BigInt(0) ? "-" : ""}${a / BigInt(10)}.${a % BigInt(10)}%`;
  })();
  const cardNote = data.costComplete ? undefined : P.cards.unavailableNote;
  const plain = (v: string | null) => (v === null ? P.cards.unavailable : toUnits(v, 2) < BigInt(0) ? `(${money(v)})` : money(v));

  const row = (cls: string, label: string, value: ReactNode, key?: string) => (
    <tr className={cls} key={key ?? label}>
      <td>{label}</td>
      <td className="num">{value}</td>
    </tr>
  );

  return (
    <>
      <ReportActions backHref={back} backLabel={P.backToFilters} />
      <ReportDocument
        title={P.reportTitle}
        company={company}
        generatedAt={generatedAt}
        generatedBy={creator ? `${creator.firstName} ${creator.lastName}` : undefined}
        testId="report-profit-loss"
        meta={[
          { label: P.meta.period, value: <bdi dir="ltr">{`${day(data.from)} – ${day(data.to)}`}</bdi> },
          { label: P.meta.currency, value: <bdi dir="ltr">{`${data.currency.code} (${data.currency.symbol})`}</bdi> },
          { label: P.meta.costing, value: P.meta.costingValue },
          { label: P.meta.status, value: data.costComplete ? P.meta.statusComplete : P.meta.statusIncomplete },
        ]}
      >
        {data.empty ? (
          <div className="bp-report-empty" data-testid="report-empty">
            {P.empty}
          </div>
        ) : (
          <>
            <ReportSummary
              testId="report-summary"
              items={[
                { label: P.cards.netSales, value: plain(L.netSales) },
                { label: P.cards.grossProfit, value: plain(L.grossProfit), note: cardNote },
                { label: P.cards.operatingExpenses, value: plain(L.totalExpenses) },
                { label: P.cards.netProfit, value: plain(L.netProfit), note: cardNote, strong: true },
              ]}
            />

            {!data.costComplete && (
              <section className="bp-pl-alert" role="alert" data-testid="pl-incomplete">
                <b>{P.incomplete.title}</b>
                <p>{P.incomplete.body}</p>
                {data.unavailable.length > 0 && (
                  <table className="bp-report-table" data-testid="pl-unavailable">
                    <thead>
                      <tr>
                        <th style={{ whiteSpace: "nowrap" }}>{P.incomplete.code}</th>
                        <th>{P.incomplete.name}</th>
                        <th className="num">{P.incomplete.documents}</th>
                        <th style={{ whiteSpace: "nowrap" }}>{P.incomplete.refs}</th>
                        <th>{P.incomplete.reason}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.unavailable.map((u) => (
                        <tr key={u.productId}>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <bdi dir="ltr">{u.code}</bdi>
                          </td>
                          <td>{u.name}</td>
                          <td className="num">
                            <bdi dir="ltr">{u.documents}</bdi>
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <bdi dir="ltr">{u.refs.join(", ")}</bdi>
                          </td>
                          <td data-reason={u.reason}>{u.reason === "NO_CURRENCY_BASIS" ? P.incomplete.reasonBasis : P.incomplete.reasonUnknown}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="bp-report-muted">{P.incomplete.why}</p>
                <p className="sp-noprint" data-testid="pl-setup-note">
                  {canSetCostBaseline(session.user.role) ? (
                    <>
                      {P.incomplete.setupOwner}{" "}
                      <Link href={`/profit-loss/setup?currency=${data.currency.id}`} className="sp-btn sp-btn--secondary" data-testid="pl-setup-link">
                        {P.incomplete.setupLink}
                      </Link>
                    </>
                  ) : (
                    P.incomplete.setupAdmin
                  )}
                </p>
              </section>
            )}

            {data.issues.length > 0 && (
              <section className="bp-pl-alert" role="alert" data-testid="pl-issues">
                <b>{P.issues.title}</b>
                <p>{P.issues.body}</p>
                <ul>
                  {data.issues.map((i, n) => (
                    <li key={n}>
                      <bdi dir="ltr">{i.code}</bdi> {i.name} — {i.day ? fmt(P.issues.negative, { date: day(i.day), ref: i.ref || "—" }) : P.issues.variance}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <table className="bp-report-table bp-pl" data-testid="pl-statement">
              <thead>
                <tr>
                  <th>{P.col.item}</th>
                  <th className="num">{P.col.amount}</th>
                </tr>
              </thead>
              <tbody>
                {row("is-section", P.row.revenue, "", "s1")}
                {row("ind", P.row.sales, amt(L.sales), "sales")}
                {row("ind", P.row.orderDiscounts, amt(L.orderDiscounts, { negate: true }), "disc")}
                {row("ind", P.row.salesReturns, amt(L.salesReturns, { negate: true }), "ret")}
                {row("is-total", P.row.netSales, amt(L.netSales), "net")}

                {row("is-section", P.row.cogsSection, "", "s2")}
                {row("ind", P.row.cogsSold, amt(L.cogsSales), "cogs")}
                {row("ind", P.row.cogsReturned, amt(L.cogsReturns, { negate: true }), "cogsr")}
                {row("is-total", P.row.cogsTotal, amt(L.cogs), "cogst")}

                {row("is-total", P.row.grossProfit, amt(L.grossProfit), "gp")}
                {margin && row("is-muted", P.row.margin, <bdi dir="ltr">{margin}</bdi>, "gm")}

                {row("is-section", P.row.otherSection, "", "s3")}
                {row("ind", P.row.shipping, amt(L.shippingIncome), "ship")}
                {row("ind", P.row.adjGain, amt(L.adjustmentGains), "gain")}
                {row("ind", P.row.adjLoss, amt(L.adjustmentLosses, { negate: true }), "loss")}

                {row("is-section", P.row.expensesSection, "", "s4")}
                {L.expenses.length === 0
                  ? row("is-muted", P.row.noExpenses, amt("0.00"), "noexp")
                  : L.expenses.map((e) => (
                      <tr className="ind" key={e.categoryId} data-testid="pl-expense-row">
                        <td>{e.name}</td>
                        <td className="num">{amt(e.amount, { negate: true })}</td>
                      </tr>
                    ))}
                {row("is-total", P.row.totalExpenses, amt(L.totalExpenses, { negate: true }), "totx")}

                {row("is-total is-final", P.row.netProfit, amt(L.netProfit), "np")}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>{P.row.infoSection}</td>
                </tr>
                <tr className="is-info">
                  <td>{P.row.taxCollected}</td>
                  <td className="num">{amt(data.tax.collected)}</td>
                </tr>
                <tr className="is-info">
                  <td>{P.row.taxPaid}</td>
                  <td className="num">{amt(data.tax.paid)}</td>
                </tr>
              </tfoot>
            </table>

            {data.baselines.length > 0 && (
              <section className="bp-report-note bp-keep" data-testid="pl-baselines">
                <b>{P.baselines.title}</b> — {P.baselines.note}
                <table className="bp-report-table" style={{ marginTop: 6 }}>
                  <thead>
                    <tr>
                      <th>{P.baselines.code}</th>
                      <th>{P.baselines.name}</th>
                      <th>{P.baselines.effective}</th>
                      <th className="num">{P.baselines.cost}</th>
                      <th className="num">{P.baselines.quantity}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.baselines.map((b) => (
                      <tr key={b.code}>
                        <td>
                          <bdi dir="ltr">{b.code}</bdi>
                        </td>
                        <td>{b.name}</td>
                        <td>
                          <bdi dir="ltr">{formatDateTime(new Date(b.effectiveAt), dateFormat, locale)}</bdi>
                        </td>
                        <td className="num">
                          <bdi dir="ltr">{money(b.unitCost)}</bdi>
                        </td>
                        <td className="num">
                          <bdi dir="ltr">{b.quantity}</bdi>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            <section className="bp-report-note bp-keep" data-testid="pl-notes">
              <b>{P.notes.title}</b>
              <ol style={{ margin: "4px 0 0", paddingInlineStart: 18 }}>
                {[P.notes.n1, P.notes.n2, P.notes.n3, P.notes.n4, P.notes.n5, P.notes.n6, P.notes.n7].map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ol>
            </section>
          </>
        )}
      </ReportDocument>
    </>
  );
}
