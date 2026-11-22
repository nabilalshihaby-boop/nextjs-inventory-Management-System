import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getReportCompany } from "@/lib/report-company";
import { canViewInventoryReports } from "@/lib/roles";
import { getStockBalance, parseBalanceParams } from "@/lib/inventory-reports";
import { getLocaleInfo } from "@/lib/i18n/server";
import ReportActions from "@/components/reports/ReportActions";
import ReportDocument, { ReportSummary } from "@/components/reports/ReportDocument";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLocaleInfo()).dict.invReports.balance.pageTitle };
}

export const instant = false;

// Printable Stock Balance by Warehouse (opened by "View Report"). OWNER/ADMIN only — anyone else is
// redirected before any data is read. Rows come from the persisted stock of the ONE selected warehouse
// (never product-level totals); every row is rendered (no pagination). Read-only: nothing is written.
export default async function StockBalanceReportPage({ searchParams }: PageProps<"/reports/stock-balance">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canViewInventoryReports(session.user.role)) redirect("/dashboard");

  const { dict: T } = await getLocaleInfo();
  const C = T.invReports.common;
  const R = T.invReports.balance;
  const sp = await searchParams;
  const q = parseBalanceParams(sp);
  const back = `/inventory-reports/stock-balance?${new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString()}`;
  const data = q.ok ? await getStockBalance(q.p) : null;
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

  const [{ company, generatedAt }, creator] = await Promise.all([getReportCompany(), db.user.findUnique({ where: { id: session.user.id }, select: { firstName: true, lastName: true } })]);
  const status = (s: "IN" | "LOW" | "OUT") => (
    <span className={`sp-badge sp-badge--${s === "IN" ? "success" : s === "LOW" ? "warning" : "danger"}`} style={{ whiteSpace: "nowrap" }}>
      <i />
      {R.status[s]}
    </span>
  );
  const t = data.totals;

  return (
    <>
      <ReportActions backHref={back} backLabel={C.backToFilters} />
      <ReportDocument
        title={R.title}
        company={company}
        generatedAt={generatedAt}
        generatedBy={creator ? `${creator.firstName} ${creator.lastName}` : undefined}
        orientation="landscape"
        testId="report-stock-balance"
        meta={[
          { label: C.warehouse, value: data.warehouse.name },
          { label: C.category, value: data.category ?? C.allCategories },
          { label: C.brand, value: data.brand ?? C.allBrands },
          { label: R.includeZeroMeta, value: q.p.includeZero ? C.yes : C.no },
        ]}
      >
        <ReportSummary
          testId="report-summary"
          items={[
            { label: R.totals.products, value: String(t.products) },
            { label: R.totals.quantity, value: t.quantity.length ? t.quantity.map((x) => `${x.value} ${x.unit}`).join(" · ") : "0", note: R.quantityNote },
            { label: R.totals.lowStock, value: String(t.lowStock) },
            { label: R.totals.outOfStock, value: String(t.outOfStock) },
          ]}
        />
        {data.rows.length === 0 ? (
          <div className="bp-report-empty" data-testid="report-empty">
            {R.empty}
          </div>
        ) : (
          <table className="bp-report-table" data-testid="report-rows">
            <thead>
              <tr>
                <th>{R.cols.code}</th>
                <th>{R.cols.name}</th>
                <th>{R.cols.category}</th>
                <th>{R.cols.brand}</th>
                <th>{R.cols.unit}</th>
                <th className="num">{R.cols.inStock}</th>
                <th className="num">{R.cols.alert}</th>
                <th>{R.cols.status}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.code} data-code={r.code} data-status={r.status}>
                  <td>
                    <bdi dir="ltr">{r.code}</bdi>
                  </td>
                  <td>{r.name}</td>
                  <td>{r.category}</td>
                  <td>{r.brand}</td>
                  <td>{r.unit}</td>
                  <td className="num" data-testid="qty">
                    <bdi dir="ltr">{r.inStock}</bdi>
                  </td>
                  <td className="num">
                    <bdi dir="ltr">{r.alert}</bdi>
                  </td>
                  <td>{status(r.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportDocument>
    </>
  );
}
