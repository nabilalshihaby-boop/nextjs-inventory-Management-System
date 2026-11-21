import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { getReportCompany } from "@/lib/report-company";
import { getDict, getLocaleInfo } from "@/lib/i18n/server";
import { fmt as fmt2 } from "@/lib/i18n/config";
import { canUsePos } from "@/lib/roles";
import { getSystemSettings } from "@/lib/settings";
import { Prisma } from "@/app/generated/prisma/client";
import ReportActions from "@/components/reports/ReportActions";
import ReportDocument, { ReportSummary } from "@/components/reports/ReportDocument";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).registerReport.title };
}

export const instant = false;

// Register session report (opened by "View Report" in the POS Register Details). OWNER/ADMIN only —
// anyone else is redirected before any session is read. Everything is re-read from the stored
// session and its linked POS CASH tenders; the URL only carries the session id. Read-only.
// A CLOSED session shows its stored final snapshot; an OPEN one shows live figures (clearly marked).
export default async function RegisterSessionReportPage({ params }: PageProps<"/reports/register-session/[sessionId]">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canUsePos(session.user.role)) redirect("/dashboard");

    const { sessionId } = await params;
  const { dict: T, locale } = await getLocaleInfo();
  const RR = T.registerReport;
  if (typeof sessionId !== "string" || sessionId.length > 64) notFound();
  const rs = await db.cashRegisterSession.findUnique({
    where: { id: sessionId },
    include: {
      cashBankAccount: { select: { name: true, currency: { select: { code: true, symbol: true } } } },
      counts: { orderBy: { value: "desc" }, select: { id: true, value: true, label: true, count: true, lineTotal: true } },
      movements: {
        orderBy: { number: "asc" },
        select: { reference: true, type: true, amount: true, notes: true, createdAt: true, createdById: true, fromAccount: { select: { name: true } }, toAccount: { select: { name: true } }, transaction: { select: { reference: true } } },
      },
      tenders: {
        where: { paymentMethod: "Cash" },
        orderBy: { number: "asc" },
        select: { reference: true, amount: true, createdAt: true, customer: { select: { name: true } }, allocations: { select: { sale: { select: { reference: true } } } } },
      },
    },
  });
  if (!rs) notFound();

  const [{ company, generatedAt }, settings, users, creator] = await Promise.all([
    getReportCompany(),
    getSystemSettings(),
    db.user.findMany({ where: { id: { in: [rs.openedById, ...(rs.closedById ? [rs.closedById] : []), ...rs.movements.map((x) => x.createdById)] } }, select: { id: true, firstName: true, lastName: true } }),
    db.user.findUnique({ where: { id: session.user.id }, select: { firstName: true, lastName: true } }),
  ]);
  const uname = (id: string | null) => {
    const u = users.find((x) => x.id === id);
    return u ? `${u.firstName} ${u.lastName}` : "—";
  };
  const cur = { code: rs.cashBankAccount.currency.code, symbol: rs.cashBankAccount.currency.symbol, right: !!settings?.currencyIconRight };
  const m = (v: Prisma.Decimal | { toFixed: (n: number) => string }) => formatMoney(v.toFixed(2), cur);
  const fmt = (d: Date) => formatDateTime(d, settings?.dateFormat, locale);
  const sales = rs.tenders.reduce((n, t) => n.plus(t.amount), new Prisma.Decimal(0));
  const cashIn = rs.movements.filter((x) => x.type === "CASH_IN").reduce((n, x) => n.plus(x.amount), new Prisma.Decimal(0));
  const cashOut = rs.movements.filter((x) => x.type === "CASH_OUT").reduce((n, x) => n.plus(x.amount), new Prisma.Decimal(0));
  const closed = rs.status === "CLOSED";
  const live = rs.openingCash.plus(sales).plus(cashIn).minus(cashOut);
  const expected = closed ? (rs.expectedCash ?? live) : live;

  return (
    <>
      <ReportActions backHref="/pos" backLabel={T.report.backToPos} />
      <ReportDocument
                title={RR.title}
        company={company}
        generatedAt={generatedAt}
        generatedBy={creator ? `${creator.firstName} ${creator.lastName}` : undefined}
        testId="report-register-session"
        meta={[
          { label: RR.register, value: rs.reference },
          { label: RR.cashAccount, value: rs.cashBankAccount.name },
          { label: RR.status, value: closed ? RR.closedStatus : RR.openStatus },
          { label: RR.opened, value: `${fmt(rs.openedAt)} · ${uname(rs.openedById)}` },
          { label: RR.closed, value: rs.closedAt ? `${fmt(rs.closedAt)} · ${uname(rs.closedById)}` : "—" },
        ]}
      >
        <ReportSummary
          testId="register-summary"
          items={[
            { label: RR.openingCash, value: m(rs.openingCash) },
            { label: RR.cashSales, value: m(sales), note: fmt2(rs.tenders.length === 1 ? RR.cashPayment : RR.cashPayments, { n: rs.tenders.length }) },
            { label: RR.cashInLabel, value: m(cashIn), note: fmt2(RR.movements, { n: rs.movements.filter((x) => x.type === "CASH_IN").length }) },
            { label: RR.cashOutLabel, value: m(cashOut), note: fmt2(RR.movements, { n: rs.movements.filter((x) => x.type === "CASH_OUT").length }) },
            { label: RR.expected, value: m(expected) },
            { label: RR.actual, value: rs.closingCash ? m(rs.closingCash) : "—" },
            { label: RR.difference, value: rs.difference ? m(rs.difference) : "—", strong: true },
          ]}
        />
        <table className="bp-report-table" data-testid="register-tenders">
          <thead>
            <tr>
              <th>{RR.colTime}</th>
              <th>{RR.colPayment}</th>
              <th>{RR.colSale}</th>
              <th>{RR.colCustomer}</th>
              <th className="num">{RR.colCashAmount}</th>
            </tr>
          </thead>
          <tbody>
            {rs.tenders.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center" }}>{RR.noTenders}</td>
              </tr>
            )}
            {rs.tenders.map((t) => (
              <tr key={t.reference} data-ref={t.reference}>
                <td style={{ whiteSpace: "nowrap" }}>{fmt(t.createdAt)}</td>
                <td>{t.reference}</td>
                <td>{t.allocations.map((a) => a.sale.reference).join(", ")}</td>
                <td>{t.customer.name}</td>
                <td className="num">{m(t.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-testid="register-total">
              <td colSpan={4}>{RR.totalSales}</td>
              <td className="num">{m(sales)}</td>
            </tr>
          </tfoot>
        </table>
        <h2 className="t-section-title" style={{ margin: "14px 0 6px" }}>{RR.movementsTitle}</h2>
        <table className="bp-report-table" data-testid="register-movements">
          <thead>
            <tr>
              <th>{RR.colTime}</th>
              <th>{RR.colReference}</th>
              <th>{RR.colType}</th>
              <th>{RR.colFrom}</th>
              <th>{RR.colTo}</th>
              <th>{RR.colReason}</th>
              <th>{RR.colUser}</th>
              <th className="num">{RR.colAmount}</th>
            </tr>
          </thead>
          <tbody>
            {rs.movements.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: "center" }}>{RR.noMovements}</td>
              </tr>
            )}
            {rs.movements.map((x) => (
              <tr key={x.reference} data-ref={x.reference}>
                <td style={{ whiteSpace: "nowrap" }}>{fmt(x.createdAt)}</td>
                <td>{x.reference}<span className="bp-report-muted" style={{ display: "block" }}>{x.transaction.reference}</span></td>
                <td>{T.register.movement[x.type]}</td>
                <td>{x.fromAccount.name}</td>
                <td>{x.toAccount.name}</td>
                <td>{x.notes}</td>
                <td>{uname(x.createdById)}</td>
                <td className="num">{x.type === "CASH_IN" ? "+" : "-"}{m(x.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-testid="register-move-totals">
              <td colSpan={7}>{fmt2(RR.moveTotals, { in: m(cashIn), out: m(cashOut) })}</td>
              <td className="num">{m(cashIn.minus(cashOut))}</td>
            </tr>
          </tfoot>
        </table>
        {rs.counts.length > 0 && (
          <>
            <h2 className="t-section-title" style={{ margin: "14px 0 6px" }}>{RR.countTitle}</h2>
            <table className="bp-report-table" data-testid="register-counts">
              <thead>
                <tr>
                  <th className="num">{RR.colDenomination}</th>
                  <th>{RR.colLabel}</th>
                  <th className="num">{RR.colCount}</th>
                  <th className="num">{RR.colLineTotal}</th>
                </tr>
              </thead>
              <tbody>
                {rs.counts.map((c) => (
                  <tr key={c.id} data-value={c.value.toFixed(2)}>
                    <td className="num">{m(c.value)}</td>
                    <td>{c.label ?? "—"}</td>
                    <td className="num">{c.count}</td>
                    <td className="num">{m(c.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr data-testid="register-counted-total">
                  <td colSpan={3}>{RR.countedTotal}</td>
                  <td className="num">{m(rs.counts.reduce((n, c) => n.plus(c.lineTotal), new Prisma.Decimal(0)))}</td>
                </tr>
              </tfoot>
            </table>
          </>
        )}
        {(rs.openingNotes || rs.closingNotes) && (
          <p className="bp-report-note">
                        {rs.openingNotes ? fmt2(RR.openingNotes, { notes: rs.openingNotes }) : ""}
            {rs.closingNotes ? fmt2(RR.closingNotes, { notes: rs.closingNotes }) : ""}
          </p>
        )}
        <p className="bp-report-note">{RR.footnote}</p>
      </ReportDocument>
    </>
  );
}
