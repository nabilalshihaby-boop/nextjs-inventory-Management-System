import { recordOutOfScope } from "@/lib/access-scope";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatMoney, formatQuantity } from "@/lib/money";
import { getReportCompany } from "@/lib/report-company";
import { getLocaleInfo } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import { canUsePos } from "@/lib/roles";
import { getSystemSettings } from "@/lib/settings";
import ReportActions from "@/components/reports/ReportActions";
import ReportDocument, { ReportSummary } from "@/components/reports/ReportDocument";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLocaleInfo()).dict.posReceipt.title };
}

export const instant = false;

// POS receipt (opened by "View Receipt" after a checkout). OWNER/ADMIN only — USER is redirected
// before any sale is read. Everything is re-read from the stored sale / line snapshots / payment;
// nothing comes from the URL except the sale id, and only POS sales (those with a checkout key)
// have a receipt. Read-only; the shared report document + toolbar supply the only Print Report.
export default async function PosReceiptPage({ params }: PageProps<"/reports/pos-receipt/[saleId]">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canUsePos(session.user)) redirect("/dashboard");

  const { dict, locale } = await getLocaleInfo();
  const R = dict.posReceipt;
  const { saleId } = await params;
  if (typeof saleId !== "string" || saleId.length > 64) notFound();
  if (await recordOutOfScope("sale", saleId)) notFound();
  const sale = await db.sale.findFirst({
    where: { id: saleId, posCheckoutKey: { not: null } },
    select: {
      reference: true, createdAt: true, notes: true, subtotal: true, orderTaxAmount: true, grandTotal: true, paidAmount: true, createdById: true,
      customer: { select: { name: true, phoneNumber: true, email: true } },
      warehouse: { select: { name: true } },
      currency: { select: { code: true, symbol: true } },
      items: { orderBy: { id: "asc" }, select: { id: true, productCode: true, productName: true, unitName: true, quantity: true, unitPrice: true, taxAmount: true, subtotal: true } },
      paymentAllocations: { orderBy: { payment: { number: "asc" } }, select: { amount: true, payment: { select: { reference: true, paymentMethod: true, amount: true, cashBankAccount: { select: { name: true } } } } } },
    },
  });
  if (!sale) notFound();

  const [{ company, generatedAt }, settings, cashier] = await Promise.all([
    getReportCompany(),
    getSystemSettings(),
    sale.createdById ? db.user.findUnique({ where: { id: sale.createdById }, select: { firstName: true, lastName: true } }) : Promise.resolve(null),
  ]);
  const cur = { code: sale.currency.code, symbol: sale.currency.symbol, right: !!settings?.currencyIconRight };
  const m = (v: { toFixed: (n: number) => string }) => formatMoney(v.toFixed(2), cur);
  const pays = sale.paymentAllocations.map((a) => a.payment);
  const due = sale.grandTotal.minus(sale.paidAmount);

  return (
    <>
      <ReportActions backHref="/pos" backLabel={dict.report.backToPos} />
      <ReportDocument
        title={R.title}
        company={company}
        generatedAt={generatedAt}
        generatedBy={cashier ? `${cashier.firstName} ${cashier.lastName}` : undefined}
        testId="report-pos-receipt"
        meta={[
          { label: R.sale, value: <bdi dir="ltr">{sale.reference}</bdi> },
          { label: R.dateTime, value: <bdi dir="ltr">{formatDateTime(sale.createdAt, settings?.dateFormat, locale)}</bdi> },
          { label: R.customer, value: sale.customer.name },
          { label: R.warehouse, value: sale.warehouse.name },
          { label: R.servedBy, value: cashier ? `${cashier.firstName} ${cashier.lastName}` : "—" },
        ]}
      >
        <table className="bp-report-table" data-testid="receipt-items">
          <thead>
            <tr>
              <th>{R.colItem}</th>
              <th className="num">{R.colQty}</th>
              <th className="num">{R.colUnitPrice}</th>
              <th className="num">{R.colTax}</th>
              <th className="num">{R.colAmount}</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((i) => (
              <tr key={i.id} data-code={i.productCode}>
                <td>
                  {i.productName}
                  <span className="bp-report-muted" style={{ display: "block" }}><bdi dir="ltr">{i.productCode}</bdi></span>
                </td>
                <td className="num"><bdi dir="ltr">{formatQuantity(i.quantity.toFixed(3))}</bdi> {i.unitName}</td>
                <td className="num"><bdi dir="ltr">{m(i.unitPrice)}</bdi></td>
                <td className="num"><bdi dir="ltr">{m(i.taxAmount)}</bdi></td>
                <td className="num"><bdi dir="ltr">{m(i.subtotal)}</bdi></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-testid="receipt-total">
              <td colSpan={4}>{R.grandTotal}</td>
              <td className="num"><bdi dir="ltr">{m(sale.grandTotal)}</bdi></td>
            </tr>
          </tfoot>
        </table>
        <ReportSummary
          testId="receipt-summary"
          items={[
            { label: R.subTotal, value: m(sale.subtotal) },
            { label: R.orderTax, value: m(sale.orderTaxAmount) },
            { label: R.grandTotal, value: m(sale.grandTotal) },
            { label: R.paid, value: m(sale.paidAmount) },
            { label: R.due, value: m(due), strong: true },
          ]}
        />
        <table className="bp-report-table" data-testid="receipt-payments" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>{R.colPayment}</th>
              <th>{R.colMethod}</th>
              <th>{R.colInto}</th>
              <th className="num">{R.colAmount}</th>
            </tr>
          </thead>
          <tbody>
            {pays.map((x) => (
              <tr key={x.reference} data-testid="receipt-payment-row">
                <td><bdi dir="ltr">{x.reference}</bdi></td>
                <td>{(dict.pos.methods as Record<string, string>)[x.paymentMethod] ?? x.paymentMethod}</td>
                <td>{x.cashBankAccount.name}</td>
                <td className="num"><bdi dir="ltr">{m(x.amount)}</bdi></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-testid="receipt-paid-total">
              <td colSpan={3}>{fmt(R.totalPaid, { status: due.gt(0) ? R.statusPartial : R.statusPaid })}</td>
              <td className="num"><bdi dir="ltr">{m(sale.paidAmount)}</bdi></td>
            </tr>
          </tfoot>
        </table>
        {sale.notes && <p className="bp-report-note">{fmt(R.notes, { notes: sale.notes })}</p>}
        <p className="bp-report-note">{R.thanks}</p>
      </ReportDocument>
    </>
  );
}
