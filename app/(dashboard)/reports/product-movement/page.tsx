import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { getReportCompany } from "@/lib/report-company";
import { canViewInventoryReports } from "@/lib/roles";
import { getSystemSettings } from "@/lib/settings";
import { getProductMovement, parseMovementParams } from "@/lib/inventory-reports";
import { getLocaleInfo } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import ReportActions from "@/components/reports/ReportActions";
import ReportDocument from "@/components/reports/ReportDocument";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLocaleInfo()).dict.invReports.movement.pageTitle };
}

export const instant = false;

// Printable Product Movement / Stock Card (opened by "View Report"). OWNER/ADMIN only — anyone else is
// redirected before any data is read. One ledger per warehouse (balances are never added across
// warehouses); opening = everything before From; closing = opening + the period's movements. Built only
// from the saved source documents that move stock. Read-only: nothing is written.
export default async function ProductMovementReportPage({ searchParams }: PageProps<"/reports/product-movement">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canViewInventoryReports(session.user.role)) redirect("/dashboard");

  const { dict: T, locale } = await getLocaleInfo();
  const C = T.invReports.common;
  const R = T.invReports.movement;
  const sp = await searchParams;
  const q = parseMovementParams(sp);
  const back = `/inventory-reports/product-movement?${new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString()}`;
  const data = q.ok ? await getProductMovement(q.p) : null;
  if (!q.ok || !data) {
    return (
      <>
        <ReportActions backHref={back} backLabel={C.backToFilters} />
        <div className="sp-card sp-empty" data-testid="report-none">
          <span>{q.ok ? C.errNotFound : C[q.error]}</span>
        </div>
      </>
    );
  }

  const [{ company, generatedAt }, creator, settings] = await Promise.all([
    getReportCompany(),
    db.user.findUnique({ where: { id: session.user.id }, select: { firstName: true, lastName: true } }),
    getSystemSettings(),
  ]);
  const dateOf = (day: string) => formatDate(new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))), settings?.dateFormat);
  const timeOf = (ms: number) => {
    const d = new Date(ms);
    const h = d.getHours();
    const mer = locale === "ar" ? (h < 12 ? "ص" : "م") : h < 12 ? "AM" : "PM";
    return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${mer}`;
  };
  const { from, to } = q.p;
  const period = from || to ? `${from ? dateOf(from) : "…"} – ${to ? dateOf(to) : "…"}` : C.allDates;
  const empty = data.sections.length === 0;

  return (
    <>
      <ReportActions backHref={back} backLabel={C.backToFilters} />
      <ReportDocument
        title={R.title}
        company={company}
        generatedAt={generatedAt}
        generatedBy={creator ? `${creator.firstName} ${creator.lastName}` : undefined}
        orientation="landscape"
        testId="report-product-movement"
        meta={[
          { label: R.product, value: <bdi dir="auto">{`${data.product.code} — ${data.product.name}`}</bdi> },
          { label: R.unit, value: data.product.unit },
          { label: C.warehouse, value: data.warehouse ?? C.allWarehouses },
          { label: C.period, value: <bdi dir="ltr">{period}</bdi> },
        ]}
      >
        {empty && (
          <div className="bp-report-empty" data-testid="report-empty">
            {R.empty}
          </div>
        )}
        {data.sections.map((s) => (
          <section key={s.warehouse.id} data-testid="ledger" data-warehouse={s.warehouse.name} style={{ marginBottom: 20 }}>
            <h2 style={{ font: "700 13px/1.4 var(--font-display, var(--font-body))", margin: "8px 0 6px", breakInside: "avoid" }}>{fmt(R.sectionTitle, { name: s.warehouse.name })}</h2>
            <table className="bp-report-table">
              <thead>
                <tr>
                  <th>{R.cols.date}</th>
                  <th>{R.cols.ref}</th>
                  <th>{R.cols.type}</th>
                  <th>{R.cols.warehouse}</th>
                  <th className="num">{R.cols.in}</th>
                  <th className="num">{R.cols.out}</th>
                  <th className="num">{R.cols.balance}</th>
                  <th>{R.cols.notes}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="is-muted" data-testid="opening-row">
                  <td colSpan={6}>
                    {R.opening}
                    {from ? <> · <bdi dir="ltr">{dateOf(from)}</bdi></> : null}
                  </td>
                  <td className="num" data-testid="opening">
                    <bdi dir="ltr">{s.opening}</bdi>
                  </td>
                  <td />
                </tr>
                {s.rows.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center" }}>
                      {R.noMovements}
                    </td>
                  </tr>
                )}
                {s.rows.map((r, i) => (
                  <tr key={i} data-testid="movement-row" data-kind={r.kind} data-ref={r.ref}>
                    <td>
                      <bdi dir="ltr">{dateOf(r.day)}</bdi>
                      <span className="bp-report-muted" style={{ display: "block" }}>{fmt(R.recordedAt, { time: timeOf(r.at) })}</span>
                    </td>
                    <td>
                      {r.link && r.ref ? (
                        <Link href={r.link}>
                          <bdi dir="ltr">{r.ref}</bdi>
                        </Link>
                      ) : r.link ? (
                        <Link href={r.link}>{data.product.code}</Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{R.types[r.kind]}</td>
                    <td>{s.warehouse.name}</td>
                    <td className="num" data-testid="in">
                      <bdi dir="ltr">{r.qtyIn}</bdi>
                    </td>
                    <td className="num" data-testid="out">
                      <bdi dir="ltr">{r.qtyOut}</bdi>
                    </td>
                    <td className="num" data-testid="balance">
                      <bdi dir="ltr">{r.balance}</bdi>
                    </td>
                    <td>
                      {r.counterpart ? fmt(r.kind === "TRANSFER_OUT" ? R.transferTo : R.transferFrom, { name: r.counterpart }) : null}
                      {r.counterpart && r.notes ? " · " : null}
                      {r.notes}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr data-testid="totals-row">
                  <td colSpan={4}>{R.totalsRow}</td>
                  <td className="num" data-testid="in-total">
                    <bdi dir="ltr">{s.inTotal}</bdi>
                  </td>
                  <td className="num" data-testid="out-total">
                    <bdi dir="ltr">{s.outTotal}</bdi>
                  </td>
                  <td colSpan={2} />
                </tr>
                <tr data-testid="closing-row">
                  <td colSpan={6}>{R.closing}</td>
                  <td className="num" data-testid="closing">
                    <bdi dir="ltr">{s.closing}</bdi>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
            <p className="bp-report-note" data-testid="reconcile" data-variance={s.variance ?? ""}>
              {R.current}: <bdi dir="ltr">{s.current}</bdi> {data.product.unit} — {s.variance === null ? R.reconciled : fmt(R.notReconciled, { diff: s.variance })}
            </p>
          </section>
        ))}
      </ReportDocument>
    </>
  );
}
