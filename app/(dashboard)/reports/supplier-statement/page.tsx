import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { todayLocal } from "@/lib/cash-bank";
import { db } from "@/lib/db";
import { getCountryOptions } from "@/lib/countries";
import { formatMoney } from "@/lib/money";
import { getReportCompany } from "@/lib/report-company";
import { canViewSupplierStatement } from "@/lib/roles";
import { STATEMENT_KIND_LABEL } from "@/lib/supplier-statement";
import { getSupplierStatement } from "@/lib/supplier-statement-data";
import { fromUnits, toUnits } from "@/lib/transfers";
import ReportActions from "@/components/reports/ReportActions";
import ReportDocument, { ReportSummary } from "@/components/reports/ReportDocument";

export const metadata: Metadata = { title: "Supplier Statement Report" };

export const instant = false;

// Printable Supplier Account Statement (opened by "View Report" on /suppliers/statement).
// Same access as the statement (OWNER/ADMIN; USER redirected before anything is read). The URL only
// carries the filters; every row, balance and total is re-read on the server through the SAME
// loader as the statement screen (lib/supplier-statement-data.ts), so the chronological running
// balance is identical. All rows of the period are rendered — no pagination. Read-only.
const queryShape = z.object({
  supplier: z.string().trim().min(1).max(64).optional().catch(undefined),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  currency: z.string().trim().min(1).max(64).optional().catch(undefined),
});

export default async function SupplierStatementReportPage({ searchParams }: PageProps<"/reports/supplier-statement">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canViewSupplierStatement(session.user.role)) redirect("/dashboard");

  const sp = await searchParams;
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const q = queryShape.parse({ supplier: one(sp.supplier), from: one(sp.from), to: one(sp.to), currency: one(sp.currency) });
  const [data, { company, generatedAt }] = await Promise.all([getSupplierStatement(q, todayLocal()), getReportCompany()]);

  if (!data) {
    return (
      <>
        <ReportActions backHref="/suppliers/statement" />
        <div className="sp-card sp-empty" data-testid="report-none">
          <div className="t-section-title">No suppliers yet</div>
          <span>There is no supplier statement to report.</span>
        </div>
      </>
    );
  }
  const s = data.statement;
  const back = new URLSearchParams({ supplier: s.supplier.id, from: s.from, to: s.to, ...(s.currency && s.currencies.length > 1 ? { currency: s.currency.id } : {}) });
  const supplier = await db.supplier.findUnique({ where: { id: s.supplier.id }, select: { email: true, phoneNumber: true, address: true, city: true, countryCode: true } });
  const country = new Map<string, string>(getCountryOptions().map((c) => [c.code, c.name]));
  const m = (v: string) => formatMoney(v, s.currency);
  const opening = s.opening !== "0.00";
  const debitTotal = fromUnits(toUnits(s.totalReturns, 2) + toUnits(s.totalPaid, 2), 2);
  const creator = await db.user.findUnique({ where: { id: session.user.id }, select: { firstName: true, lastName: true } });

  return (
    <>
      <ReportActions backHref={`/suppliers/statement?${back.toString()}`} backLabel="Back to Statement" />
      {data.notice && (
        <div className="sp-card sp-noprint" role="status" data-testid="report-notice" style={{ padding: "12px 16px", margin: "0 auto 16px", maxWidth: "210mm" }}>
          {data.notice}
        </div>
      )}
      <ReportDocument
        title="Supplier Account Statement"
        company={company}
        generatedAt={generatedAt}
        generatedBy={creator ? `${creator.firstName} ${creator.lastName}` : undefined}
        meta={[
          {
            label: "Supplier",
            value: (
              <>
                {s.supplier.name}
                {supplier && (
                  <span className="bp-report-muted" style={{ display: "block", fontWeight: 400 }}>
                    {[supplier.email, supplier.phoneNumber].filter(Boolean).join(" · ")}
                    <br />
                    {[supplier.address, supplier.city, country.get(supplier.countryCode) ?? supplier.countryCode].filter(Boolean).join(", ")}
                  </span>
                )}
              </>
            ),
          },
          { label: "Period", value: `${s.fromLabel} – ${s.toLabel}` },
          { label: "Currency", value: s.currency ? `${s.currency.code} (${s.currency.symbol})` : "—" },
          { label: "Transactions", value: String(s.rows.length) },
        ]}
        testId="report-supplier-statement"
      >
        <ReportSummary
          testId="report-summary"
          items={[
            { label: "Opening Balance", value: m(s.opening), note: `Before ${s.fromLabel}` },
            { label: "Total Purchases", value: m(s.totalPurchases) },
            { label: "Total Returns", value: m(s.totalReturns) },
            { label: "Total Paid", value: m(s.totalPaid) },
            { label: "Outstanding Balance", value: m(s.closing), strong: true },
          ]}
        />
        {s.rows.length === 0 && !opening ? (
          <div className="bp-report-empty" data-testid="report-empty">
            No transactions in this period.
          </div>
        ) : (
          <table className="bp-report-table" data-testid="report-table">
            <thead>
              <tr>
                <th style={{ width: "11%" }}>Date</th>
                <th style={{ width: "12%" }}>Reference</th>
                <th style={{ width: "12%" }}>Type</th>
                <th>Description</th>
                <th className="num" style={{ width: "12%" }}>Debit</th>
                <th className="num" style={{ width: "12%" }}>Credit</th>
                <th className="num" style={{ width: "13%" }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {opening && (
                <tr className="is-muted" data-testid="report-opening">
                  <td>{s.fromLabel}</td>
                  <td>—</td>
                  <td>Opening</td>
                  <td>Opening balance (before {s.fromLabel})</td>
                  <td className="num">—</td>
                  <td className="num">—</td>
                  <td className="num">{m(s.opening)}</td>
                </tr>
              )}
              {s.rows.map((r) => (
                <tr key={r.key} data-ref={r.reference}>
                  <td>{r.dateLabel}</td>
                  <td>{r.reference}</td>
                  <td>{STATEMENT_KIND_LABEL[r.kind]}</td>
                  <td>{r.description}</td>
                  <td className="num" data-col="debit">{r.debit ? m(r.debit) : "—"}</td>
                  <td className="num" data-col="credit">{r.credit ? m(r.credit) : "—"}</td>
                  <td className="num" data-col="balance">{m(r.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr data-testid="report-totals">
                <td colSpan={4}>Total</td>
                <td className="num">{m(debitTotal)}</td>
                <td className="num">{m(s.totalPurchases)}</td>
                <td className="num">{m(s.closing)}</td>
              </tr>
            </tfoot>
          </table>
        )}
        <p className="bp-report-note">Credit increases the amount owed to the supplier (purchases). Debit reduces it (purchase returns and payments). Amounts in {s.currency?.code ?? "the selected currency"} only.</p>
      </ReportDocument>
    </>
  );
}
