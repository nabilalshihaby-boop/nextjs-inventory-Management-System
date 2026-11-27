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

// Register Shift Report (a Register Session is a shift), opened from the POS Register Details. POS users whose route access includes
// register reports (see lib/access.ts) — anyone else is redirected before any session is read. Everything is re-read from the stored
// session and its linked POS CASH tenders; the URL only carries the session id. Read-only.
// A CLOSED session shows its stored final snapshot; an OPEN one shows live figures (clearly marked).
export default async function RegisterSessionReportPage({ params }: PageProps<"/reports/register-session/[sessionId]">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canUsePos(session.user)) redirect("/dashboard");

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
        select: { reference: true, type: true, amount: true, notes: true, createdAt: true, createdById: true, createdByName: true, fromAccount: { select: { name: true } }, toAccount: { select: { name: true } }, transaction: { select: { reference: true } } },
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
  // The name stored when the person acted wins (a later rename or deletion changes nothing). The live name only serves a row
  // without a snapshot, and "Former user" a row whose user is gone too.
  const uname = (id: string | null, snapshot: string | null) => {
    if (snapshot) return snapshot;
    if (!id) return "—";
    const u = users.find((x) => x.id === id);
    return u ? `${u.firstName} ${u.lastName}` : RR.formerUser;
  };
  // Whole minutes between the two stored instants (not wall-clock text, so a daylight-saving change can't distort it).
  const duration = () => {
    const ms = rs.closedAt ? rs.closedAt.getTime() - rs.openedAt.getTime() : -1;
    if (ms < 0) return "—";
    const total = Math.floor(ms / 60_000);
    const d = Math.floor(total / 1440), h = Math.floor((total % 1440) / 60), min = total % 60;
    return total === 0 ? RR.durationUnder : fmt2(d ? RR.durationDays : h ? RR.durationHours : RR.durationMinutes, { d, h, m: min });
  };
  const cur = { code: rs.cashBankAccount.currency.code, symbol: rs.cashBankAccount.currency.symbol, right: !!settings?.currencyIconRight };
  const m = (v: Prisma.Decimal | { toFixed: (n: number) => string }) => formatMoney(v.toFixed(2), cur);
  const fmt = (d: Date) => formatDateTime(d, settings?.dateFormat, locale);
  const sales = rs.tenders.reduce((n, t) => n.plus(t.amount), new Prisma.Decimal(0));
  const cashIn = rs.movements.filter((x) => x.type === "CASH_IN").reduce((n, x) => n.plus(x.amount), new Prisma.Decimal(0));
  const cashOut = rs.movements.filter((x) => x.type === "CASH_OUT").reduce((n, x) => n.plus(x.amount), new Prisma.Decimal(0));
  // A typed note keeps its own writing direction inside the label's sentence (an English note on an Arabic report, and vice versa).
  const note = (template: string, value: string) => {
    const [before, after = ""] = template.split("{notes}");
    return (
      <p>
        {before}
        <bdi dir="auto">{value}</bdi>
        {after}
      </p>
    );
  };
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
          { label: RR.opened, value: fmt(rs.openedAt) },
          { label: RR.closed, value: rs.closedAt ? fmt(rs.closedAt) : RR.notClosedYet },
          { label: RR.duration, value: duration() },
          { label: RR.openedBy, value: <bdi dir="auto">{uname(rs.openedById, rs.openedByName)}</bdi> },
          { label: RR.closedBy, value: <bdi dir="auto">{closed ? uname(rs.closedById, rs.closedByName) : RR.notClosedYet}</bdi> },
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
        {/* Only cash tenders carry a link to a register session; nothing else is inferred from times or users. */}
        <p className="bp-report-note bp-keep" data-testid="register-noncash-note" style={{ margin: "0 0 14px" }}>
          {RR.nonCashNote}
        </p>
        {(rs.openingNotes || rs.closingNotes) && (
          <div className="bp-report-notes bp-keep" data-testid="register-notes">
            {rs.closingNotes && note(RR.closingNotes, rs.closingNotes)}
            {rs.openingNotes && note(RR.openingNotes, rs.openingNotes)}
          </div>
        )}
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
        <table className="bp-report-table bp-shift-moves" data-testid="register-movements">
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
                <td>{fmt(x.createdAt)}</td>
                <td className="nb">{x.reference}<span className="bp-report-muted" style={{ display: "block" }}>{x.transaction.reference}</span></td>
                <td className="nb">{T.register.movement[x.type]}</td>
                <td>{x.fromAccount.name}</td>
                <td>{x.toAccount.name}</td>
                <td>{x.notes}</td>
                <td>{uname(x.createdById, x.createdByName)}</td>
                <td className="num">
                  <bdi dir="ltr">{(x.type === "CASH_IN" ? "+" : "-") + m(x.amount)}</bdi>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-testid="register-move-totals">
              <td colSpan={7}>{fmt2(RR.moveTotals, { in: m(cashIn), out: m(cashOut) })}</td>
              <td className="num">
                <bdi dir="ltr">{m(cashIn.minus(cashOut))}</bdi>
              </td>
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
        <p className="bp-report-note">{RR.footnote}</p>
      </ReportDocument>
    </>
  );
}
