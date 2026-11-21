import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatMoney, formatQuantity } from "@/lib/money";
import { getReportCompany } from "@/lib/report-company";
import { canUsePos } from "@/lib/roles";
import { getSystemSettings } from "@/lib/settings";
import ReportActions from "@/components/reports/ReportActions";
import ReportDocument, { ReportSummary } from "@/components/reports/ReportDocument";

export const metadata: Metadata = { title: "POS Receipt" };

export const instant = false;

// POS receipt (opened by "View Receipt" after a checkout). OWNER/ADMIN only — USER is redirected
// before any sale is read. Everything is re-read from the stored sale / line snapshots / payment;
// nothing comes from the URL except the sale id, and only POS sales (those with a checkout key)
// have a receipt. Read-only; the shared report document + toolbar supply the only Print Report.
export default async function PosReceiptPage({ params }: PageProps<"/reports/pos-receipt/[saleId]">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canUsePos(session.user.role)) redirect("/dashboard");

  const { saleId } = await params;
  if (typeof saleId !== "string" || saleId.length > 64) notFound();
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
      <ReportActions backHref="/pos" backLabel="Back to POS" />
      <ReportDocument
        title="POS Receipt"
        company={company}
        generatedAt={generatedAt}
        generatedBy={cashier ? `${cashier.firstName} ${cashier.lastName}` : undefined}
        testId="report-pos-receipt"
        meta={[
          { label: "Sale", value: sale.reference },
          { label: "Date & Time", value: formatDateTime(sale.createdAt, settings?.dateFormat) },
          { label: "Customer", value: sale.customer.name },
          { label: "Warehouse", value: sale.warehouse.name },
          { label: "Served by", value: cashier ? `${cashier.firstName} ${cashier.lastName}` : "—" },
        ]}
      >
        <table className="bp-report-table" data-testid="receipt-items">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Qty</th>
              <th className="num">Unit Price</th>
              <th className="num">Tax</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((i) => (
              <tr key={i.id} data-code={i.productCode}>
                <td>
                  {i.productName}
                  <span className="bp-report-muted" style={{ display: "block" }}>{i.productCode}</span>
                </td>
                <td className="num">{formatQuantity(i.quantity.toFixed(3))} {i.unitName}</td>
                <td className="num">{m(i.unitPrice)}</td>
                <td className="num">{m(i.taxAmount)}</td>
                <td className="num">{m(i.subtotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-testid="receipt-total">
              <td colSpan={4}>Grand Total</td>
              <td className="num">{m(sale.grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
        <ReportSummary
          testId="receipt-summary"
          items={[
            { label: "Sub Total", value: m(sale.subtotal) },
            { label: "Order Tax", value: m(sale.orderTaxAmount) },
            { label: "Grand Total", value: m(sale.grandTotal) },
            { label: "Paid", value: m(sale.paidAmount) },
            { label: "Due", value: m(due), strong: true },
          ]}
        />
        <table className="bp-report-table" data-testid="receipt-payments" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Payment</th>
              <th>Method</th>
              <th>Received Into</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {pays.map((x) => (
              <tr key={x.reference} data-testid="receipt-payment-row">
                <td>{x.reference}</td>
                <td>{x.paymentMethod}</td>
                <td>{x.cashBankAccount.name}</td>
                <td className="num">{m(x.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-testid="receipt-paid-total">
              <td colSpan={3}>Total Paid ({due.gt(0) ? "Partially paid" : "Paid"})</td>
              <td className="num">{m(sale.paidAmount)}</td>
            </tr>
          </tfoot>
        </table>
        {sale.notes && <p className="bp-report-note">Notes: {sale.notes}</p>}
        <p className="bp-report-note">Thank you for your purchase. Returns are handled through Sales Returns.</p>
      </ReportDocument>
    </>
  );
}
