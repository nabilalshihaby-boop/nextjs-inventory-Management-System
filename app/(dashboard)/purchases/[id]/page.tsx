import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getCountryOptions } from "@/lib/countries";
import { formatDateOnly, formatDateTime } from "@/lib/format";
import { formatMoney, formatQuantity } from "@/lib/money";
import { canManagePurchases } from "@/lib/roles";
import { getSystemSettings } from "@/lib/settings";
import { fromUnits, toUnits } from "@/lib/transfers";
import { paymentStatus, purchaseDue } from "@/lib/purchases";
import { getDict, getLocaleInfo } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import PurchaseDetails from "@/components/purchases/PurchaseDetails";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).purchases.details.title };
}

export const instant = false;

// Purchase Details (design/Purchase Details.html). OWNER/ADMIN only. Values are the stored
// server-computed snapshots, formatted in the purchase's own currency.
export default async function PurchaseDetailsPage({ params }: PageProps<"/purchases/[id]">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManagePurchases(session.user.role)) redirect("/dashboard");

  const { id } = await params;
  const { locale, dict: T } = await getLocaleInfo();
  const D = T.purchases.details;
  const p = await db.purchase.findUnique({
    where: { id },
    include: {
      supplier: true,
      warehouse: { select: { name: true } },
      currency: { select: { code: true, symbol: true } },
      items: { orderBy: { id: "asc" }, include: { product: { select: { code: true, name: true, purchaseUnit: { select: { name: true } } } } } },
    },
  });
  if (!p) notFound();
  const settings = await getSystemSettings();
  const cur = { code: p.currency.code, symbol: p.currency.symbol, right: !!settings?.currencyIconRight };
  const m = (v: { toFixed: (n: number) => string }) => formatMoney(v.toFixed(2), cur);
  const country = new Map<string, string>(getCountryOptions(locale).map((c) => [c.code, c.name]));
  const [creator, receiver] = await Promise.all([
    p.createdById ? db.user.findUnique({ where: { id: p.createdById }, select: { firstName: true, lastName: true } }) : null,
    p.receivedById ? db.user.findUnique({ where: { id: p.receivedById }, select: { firstName: true, lastName: true } }) : null,
  ]);
  const grand = p.grandTotal.toFixed(2), paid = p.paidAmount.toFixed(2);
  // Completed purchase returns: they reduce the due; the purchase itself is never modified.
  const [returns, returnedQty, payments] = await Promise.all([
    db.purchaseReturn.findMany({ where: { purchaseId: p.id }, orderBy: { number: "asc" }, select: { id: true, reference: true, returnDate: true, grandTotal: true } }),
    db.purchaseReturnItem.groupBy({ by: ["purchaseItemId"], where: { purchaseReturn: { purchaseId: p.id } }, _sum: { quantity: true } }),
    db.supplierPaymentAllocation.findMany({ where: { purchaseId: p.id }, orderBy: { payment: { number: "asc" } }, select: { amount: true, payment: { select: { id: true, reference: true, paymentDate: true, paymentMethod: true, cashBankAccount: { select: { name: true } } } } } }),
  ]);
  const returned = fromUnits(returns.reduce((a, r) => a + toUnits(r.grandTotal.toFixed(2), 2), BigInt(0)), 2);
  const backQty = new Map(returnedQty.map((r) => [r.purchaseItemId, r._sum.quantity]));
  const due = purchaseDue(grand, paid, returned);
  const hasDue = toUnits(due, 2) > BigInt(0);
  // Refunds / supplier credit aren't built: a return can only reduce what is still owed.
  const canReturn = hasDue && p.status === "RECEIVED" && p.items.some((i) => i.quantity.gt(backQty.get(i.id) ?? 0));

  return (
    <PurchaseDetails
      purchase={{
        id: p.id,
        reference: p.reference,
        status: p.status,
        date: formatDateOnly(p.purchaseDate, settings?.dateFormat),
        warehouse: p.warehouse.name,
        createdBy: creator ? `${creator.firstName} ${creator.lastName}` : "—",
        createdOn: formatDateTime(p.createdAt, settings?.dateFormat, locale),
        receivedOn: p.receivedAt ? (receiver ? fmt(D.receivedBy, { on: formatDateTime(p.receivedAt, settings?.dateFormat, locale), by: `${receiver.firstName} ${receiver.lastName}` }) : formatDateTime(p.receivedAt, settings?.dateFormat, locale)) : null,
        notes: p.notes ?? "",
        paymentStatus: paymentStatus(paid, grand, returned),
        paid: formatMoney(paid, cur),
        returned: formatMoney(returned, cur),
        due: formatMoney(due, cur),
        canReturn,
        canPay: hasDue,
        payments: payments.map((a) => ({ id: a.payment.id, reference: a.payment.reference, date: formatDateOnly(a.payment.paymentDate, settings?.dateFormat), method: a.payment.paymentMethod, account: a.payment.cashBankAccount.name, amount: m(a.amount) })),
        returns: returns.map((r) => ({ id: r.id, reference: r.reference, date: formatDateOnly(r.returnDate, settings?.dateFormat), total: m(r.grandTotal) })),
        orderTax: `${m(p.orderTaxAmount)} (${p.orderTaxRate.toFixed(2)}%)`,
        discount: m(p.discount),
        shipping: m(p.shipping),
        grandTotal: m(p.grandTotal),
        items: p.items.map((i) => ({
          id: i.id,
          product: `${i.product.code} (${i.product.name})`,
          netUnitCost: m(i.netUnitCost),
          quantity: `${formatQuantity(i.quantity.toFixed(3))} ${i.product.purchaseUnit.name}`,
          unitCost: m(i.unitCost),
          discount: m(i.discountAmount),
          tax: `${m(i.taxAmount)}${i.taxRate.isZero() ? "" : ` (${fmt(i.taxType === "EXCLUSIVE" ? D.taxExcl : D.taxIncl, { rate: i.taxRate.toFixed(2) })})`}`,
          subtotal: m(i.subtotal),
        })),
      }}
      supplier={{ name: p.supplier.name, email: p.supplier.email, phone: p.supplier.phoneNumber, address: [p.supplier.address, p.supplier.city, country.get(p.supplier.countryCode) ?? p.supplier.countryCode].filter(Boolean).join(", ") }}
      company={{
        name: settings?.companyName || "—",
        email: settings?.defaultEmail || "—",
        phone: settings?.companyPhone || "—",
        address: [settings?.address, settings?.city, settings?.state, settings?.country ? (country.get(settings.country) ?? settings.country) : ""].filter(Boolean).join(", ") || "—",
      }}
    />
  );
}
