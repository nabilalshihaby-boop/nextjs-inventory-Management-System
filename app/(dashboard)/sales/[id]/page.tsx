import { recordOutOfScope } from "@/lib/access-scope";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getCountryOptions } from "@/lib/countries";
import { formatDateOnly, formatDateTime } from "@/lib/format";
import { formatMoney, formatQuantity } from "@/lib/money";
import { canManageSales } from "@/lib/roles";
import { getSystemSettings } from "@/lib/settings";
import { paymentStatus } from "@/lib/purchases";
import { saleDue } from "@/lib/sale-returns";
import { paymentBlockedReason, returnBlockedReason } from "@/lib/sales";
import { saleReturnState } from "@/lib/sale-data";
import { getDict, getLocaleInfo } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import SaleDetails from "@/components/sales/SaleDetails";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).sales.details.title };
}

export const instant = false;

// Sale Details (design/Sale Details.html). OWNER/ADMIN only. Values are the stored server-computed
// snapshots, in the sale's own currency. Paid is 0 until customer payments exist (Due = Grand Total).
export default async function SaleDetailsPage({ params }: PageProps<"/sales/[id]">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageSales(session.user)) redirect("/dashboard");

  const { id } = await params;
  const { locale, dict: T } = await getLocaleInfo();
  const D = T.sales.details;
  if (await recordOutOfScope("sale", id)) notFound();
  const s = await db.sale.findUnique({
    where: { id },
    include: { customer: true, warehouse: { select: { name: true } }, currency: { select: { code: true, symbol: true } }, quotation: { select: { id: true, reference: true } }, items: { orderBy: { id: "asc" } } },
  });
  if (!s) notFound();
  const settings = await getSystemSettings();
  const cur = { code: s.currency.code, symbol: s.currency.symbol, right: !!settings?.currencyIconRight };
  const m = (v: { toFixed: (n: number) => string }) => formatMoney(v.toFixed(2), cur);
  const country = new Map<string, string>(getCountryOptions(locale).map((c) => [c.code, c.name]));
  const userIds = [s.createdById, s.completedById].filter((x): x is string => !!x);
  const users = new Map((userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }) : []).map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
  const [returns, state, payments] = await Promise.all([
    db.saleReturn.findMany({ where: { saleId: s.id }, orderBy: { number: "asc" }, select: { id: true, reference: true, returnDate: true, grandTotal: true } }),
    saleReturnState([s.id]),
    db.customerPaymentAllocation.findMany({ where: { saleId: s.id }, orderBy: { payment: { number: "asc" } }, select: { amount: true, payment: { select: { id: true, reference: true, paymentDate: true, paymentMethod: true, cashBankAccount: { select: { name: true } } } } } }),
  ]);
  const st = state.get(s.id) ?? { returned: "0.00", fullyReturned: false };
  const grand = s.grandTotal.toFixed(2), paid = s.paidAmount.toFixed(2);
  const due = saleDue(grand, paid, st.returned);

  return (
    <SaleDetails
      sale={{
        id: s.id,
        reference: s.reference,
        status: s.status,
        date: formatDateOnly(s.saleDate, settings?.dateFormat),
        warehouse: s.warehouse.name,
        createdBy: (s.createdById && users.get(s.createdById)) || "—",
        createdOn: formatDateTime(s.createdAt, settings?.dateFormat, locale),
        completedOn: s.completedAt ? (s.completedById && users.get(s.completedById) ? fmt(D.completedBy, { on: formatDateTime(s.completedAt, settings?.dateFormat, locale), by: users.get(s.completedById)! }) : formatDateTime(s.completedAt, settings?.dateFormat, locale)) : null,
        quotation: s.quotation,
        notes: s.notes ?? "",
        paid: m(s.paidAmount),
        returned: formatMoney(st.returned, cur),
        due: formatMoney(due, cur),
        paymentStatus: paymentStatus(paid, grand, st.returned),
        returnBlocked: returnBlockedReason(s.status, due, st.fullyReturned),
        paymentBlocked: paymentBlockedReason(s.status, due),
        payments: payments.map((a) => ({ id: a.payment.id, reference: a.payment.reference, date: formatDateOnly(a.payment.paymentDate, settings?.dateFormat), method: a.payment.paymentMethod, account: a.payment.cashBankAccount.name, amount: m(a.amount) })),
        returns: returns.map((r) => ({ id: r.id, reference: r.reference, date: formatDateOnly(r.returnDate, settings?.dateFormat), total: m(r.grandTotal) })),
        orderTax: `${m(s.orderTaxAmount)} (${s.orderTaxRate.toFixed(2)}%)`,
        discount: m(s.discount),
        shipping: m(s.shipping),
        grandTotal: m(s.grandTotal),
        items: s.items.map((i) => ({
          id: i.id,
          product: `${i.productCode} (${i.productName})`,
          netUnitPrice: m(i.netUnitPrice),
          quantity: `${formatQuantity(i.quantity.toFixed(3))} ${i.unitName}`,
          unitPrice: m(i.unitPrice),
          discount: m(i.discountAmount),
          tax: `${m(i.taxAmount)}${i.taxRate.isZero() ? "" : ` (${fmt(i.taxType === "EXCLUSIVE" ? D.taxExcl : D.taxIncl, { rate: i.taxRate.toFixed(2) })})`}`,
          subtotal: m(i.subtotal),
        })),
      }}
      customer={{ name: s.customer.name, email: s.customer.email, phone: s.customer.phoneNumber, address: [s.customer.address, s.customer.city, country.get(s.customer.countryCode) ?? s.customer.countryCode].filter(Boolean).join(", ") }}
      company={{
        name: settings?.companyName || "—",
        email: settings?.defaultEmail || "—",
        phone: settings?.companyPhone || "—",
        address: [settings?.address, settings?.city, settings?.state, settings?.country ? (country.get(settings.country) ?? settings.country) : ""].filter(Boolean).join(", ") || "—",
      }}
    />
  );
}
