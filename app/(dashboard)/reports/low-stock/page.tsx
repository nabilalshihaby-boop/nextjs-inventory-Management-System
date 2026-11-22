import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getReportCompany } from "@/lib/report-company";
import { canViewInventoryReports } from "@/lib/roles";
import { getLowStock, parseLowParams } from "@/lib/inventory-reports";
import { getLocaleInfo } from "@/lib/i18n/server";
import ReportActions from "@/components/reports/ReportActions";
import ReportDocument, { ReportSummary } from "@/components/reports/ReportDocument";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLocaleInfo()).dict.invReports.low.pageTitle };
}

export const instant = false;

// Printable Low Stock Items (opened by "View Report"). OWNER/ADMIN only — anyone else is redirected before
// any data is read. Every product/warehouse location is judged on its own stock against the product's
// Stock Alert (alert 0 = no usable alert → never listed). All rows are rendered. Read-only.
export default async function LowStockReportPage({ searchParams }: PageProps<"/reports/low-stock">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canViewInventoryReports(session.user.role)) redirect("/dashboard");

  const { dict: T } = await getLocaleInfo();
  const C = T.invReports.common;
  const R = T.invReports.low;
  const sp = await searchParams;
  const q = parseLowParams(sp);
  const back = `/inventory-reports/low-stock?${new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString()}`;
  const data = await getLowStock(q.p);
  if (!data) {
    return (
      <>
        <ReportActions backHref={back} backLabel={C.backToFilters} />
        <div className="sp-card sp-empty" data-testid="report-none">
          <span>{C.errNotFound}</span>
        </div>
      </>
    );
  }

  const [{ company, generatedAt }, creator] = await Promise.all([getReportCompany(), db.user.findUnique({ where: { id: session.user.id }, select: { firstName: true, lastName: true } })]);
  const status = (s: "LOW" | "OUT") => (
    <span className={`sp-badge sp-badge--${s === "OUT" ? "danger" : "warning"}`} style={{ whiteSpace: "nowrap" }}>
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
        testId="report-low-stock"
        meta={[
          { label: C.warehouse, value: data.warehouse ?? C.allWarehouses },
          { label: C.category, value: data.category ?? C.allCategories },
          { label: C.brand, value: data.brand ?? C.allBrands },
        ]}
      >
        <ReportSummary
          testId="report-summary"
          items={[
            { label: R.totals.items, value: String(t.items) },
            { label: R.totals.out, value: String(t.out) },
            { label: R.totals.shortage, value: t.shortage.length ? t.shortage.map((x) => `${x.value} ${x.unit}`).join(" · ") : "0", note: R.quantityNote },
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
                <th>{R.cols.warehouse}</th>
                <th className="num">{R.cols.inStock}</th>
                <th className="num">{R.cols.alert}</th>
                <th className="num">{R.cols.shortage}</th>
                <th>{R.cols.status}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={`${r.warehouse}|${r.code}`} data-code={r.code} data-warehouse={r.warehouse} data-status={r.status}>
                  <td>
                    <bdi dir="ltr">{r.code}</bdi>
                  </td>
                  <td>{r.name}</td>
                  <td>{r.category}</td>
                  <td>{r.brand}</td>
                  <td>{r.unit}</td>
                  <td>{r.warehouse}</td>
                  <td className="num">
                    <bdi dir="ltr">{r.inStock}</bdi>
                  </td>
                  <td className="num">
                    <bdi dir="ltr">{r.alert}</bdi>
                  </td>
                  <td className="num">
                    <bdi dir="ltr">{r.shortage}</bdi>
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
