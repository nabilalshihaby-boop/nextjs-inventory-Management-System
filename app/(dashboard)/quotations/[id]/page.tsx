import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getCountryOptions } from "@/lib/countries";
import { formatDateOnly, formatDateTime } from "@/lib/format";
import { formatMoney, formatQuantity } from "@/lib/money";
import { canManageQuotations } from "@/lib/roles";
import { QUOTATION_STATUS_LABEL } from "@/lib/quotations";
import { getSystemSettings } from "@/lib/settings";
import QuotationDetails from "@/components/quotations/QuotationDetails";

export const metadata: Metadata = { title: "Quotation Details" };

export const instant = false;

// Quotation Details (design/Quotation Details.html). OWNER/ADMIN only. Values are the stored
// server-computed snapshots, in the quotation's own currency.
export default async function QuotationDetailsPage({ params }: PageProps<"/quotations/[id]">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageQuotations(session.user.role)) redirect("/dashboard");

  const { id } = await params;
  const q = await db.quotation.findUnique({
    where: { id },
    include: { customer: true, warehouse: { select: { name: true } }, currency: { select: { code: true, symbol: true } }, items: { orderBy: { id: "asc" } }, sale: { select: { id: true, reference: true } } },
  });
  if (!q) notFound();
  const settings = await getSystemSettings();
  const cur = { code: q.currency.code, symbol: q.currency.symbol, right: !!settings?.currencyIconRight };
  const m = (v: { toFixed: (n: number) => string }) => formatMoney(v.toFixed(2), cur);
  const country = new Map<string, string>(getCountryOptions().map((c) => [c.code, c.name]));
  const userIds = [q.createdById, q.statusChangedById].filter((x): x is string => !!x);
  const users = new Map((userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }) : []).map((u) => [u.id, `${u.firstName} ${u.lastName}`]));

  return (
    <QuotationDetails
      quotation={{
        id: q.id,
        reference: q.reference,
        status: q.status,
        date: formatDateOnly(q.quotationDate, settings?.dateFormat),
        warehouse: q.warehouse.name,
        createdBy: (q.createdById && users.get(q.createdById)) || "—",
        createdOn: formatDateTime(q.createdAt, settings?.dateFormat),
        statusChanged: q.statusChangedAt ? `Marked as ${QUOTATION_STATUS_LABEL[q.status]} ${formatDateTime(q.statusChangedAt, settings?.dateFormat)}${q.statusChangedById && users.get(q.statusChangedById) ? ` by ${users.get(q.statusChangedById)}` : ""}` : null,
        notes: q.notes ?? "",
        sale: q.sale,
        orderTax: `${m(q.orderTaxAmount)} (${q.orderTaxRate.toFixed(2)}%)`,
        discount: m(q.discount),
        shipping: m(q.shipping),
        grandTotal: m(q.grandTotal),
        items: q.items.map((i) => ({
          id: i.id,
          product: `${i.productCode} (${i.productName})`,
          netUnitPrice: m(i.netUnitPrice),
          quantity: `${formatQuantity(i.quantity.toFixed(3))} ${i.unitName}`,
          unitPrice: m(i.unitPrice),
          discount: m(i.discountAmount),
          tax: `${m(i.taxAmount)}${i.taxRate.isZero() ? "" : ` (${i.taxRate.toFixed(2)}% ${i.taxType === "EXCLUSIVE" ? "excl." : "incl."})`}`,
          subtotal: m(i.subtotal),
        })),
      }}
      customer={{ name: q.customer.name, email: q.customer.email, phone: q.customer.phoneNumber, address: [q.customer.address, q.customer.city, country.get(q.customer.countryCode) ?? q.customer.countryCode].filter(Boolean).join(", ") }}
      company={{
        name: settings?.companyName || "—",
        email: settings?.defaultEmail || "—",
        phone: settings?.companyPhone || "—",
        address: [settings?.address, settings?.city, settings?.state, settings?.country ? (country.get(settings.country) ?? settings.country) : ""].filter(Boolean).join(", ") || "—",
      }}
    />
  );
}
