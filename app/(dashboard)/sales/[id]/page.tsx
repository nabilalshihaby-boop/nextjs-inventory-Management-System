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
import SaleDetails from "@/components/sales/SaleDetails";

export const metadata: Metadata = { title: "Sale Details" };

export const instant = false;

// Sale Details (design/Sale Details.html). OWNER/ADMIN only. Values are the stored server-computed
// snapshots, in the sale's own currency. Paid is 0 until customer payments exist (Due = Grand Total).
export default async function SaleDetailsPage({ params }: PageProps<"/sales/[id]">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageSales(session.user.role)) redirect("/dashboard");

  const { id } = await params;
  const s = await db.sale.findUnique({
    where: { id },
    include: { customer: true, warehouse: { select: { name: true } }, currency: { select: { code: true, symbol: true } }, quotation: { select: { id: true, reference: true } }, items: { orderBy: { id: "asc" } } },
  });
  if (!s) notFound();
  const settings = await getSystemSettings();
  const cur = { code: s.currency.code, symbol: s.currency.symbol, right: !!settings?.currencyIconRight };
  const m = (v: { toFixed: (n: number) => string }) => formatMoney(v.toFixed(2), cur);
  const country = new Map<string, string>(getCountryOptions().map((c) => [c.code, c.name]));
  const userIds = [s.createdById, s.completedById].filter((x): x is string => !!x);
  const users = new Map((userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }) : []).map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
  const due = s.grandTotal.minus(s.paidAmount);

  return (
    <SaleDetails
      sale={{
        id: s.id,
        reference: s.reference,
        status: s.status,
        date: formatDateOnly(s.saleDate, settings?.dateFormat),
        warehouse: s.warehouse.name,
        createdBy: (s.createdById && users.get(s.createdById)) || "—",
        createdOn: formatDateTime(s.createdAt, settings?.dateFormat),
        completedOn: s.completedAt ? `${formatDateTime(s.completedAt, settings?.dateFormat)}${s.completedById && users.get(s.completedById) ? ` by ${users.get(s.completedById)}` : ""}` : null,
        quotation: s.quotation,
        notes: s.notes ?? "",
        paid: m(s.paidAmount),
        due: m(due.isNegative() ? s.paidAmount.minus(s.paidAmount) : due),
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
          tax: `${m(i.taxAmount)}${i.taxRate.isZero() ? "" : ` (${i.taxRate.toFixed(2)}% ${i.taxType === "EXCLUSIVE" ? "excl." : "incl."})`}`,
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
