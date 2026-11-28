import { warehouseIdFilter } from "@/lib/access-scope";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { canManagePurchases, canViewPurchases } from "@/lib/roles";
import { getDefaultCurrency, getSystemSettings } from "@/lib/settings";
import { paymentStatus, purchaseDue, type PurchaseRow } from "@/lib/purchases";
import { returnedTotals } from "@/lib/purchase-return-data";
import { getDict, getLocale } from "@/lib/i18n/server";
import PurchasesTable from "@/components/purchases/PurchasesTable";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).purchases.list.title };
}

export const instant = false;

// Purchases list (design/Purchases.html). OWNER/ADMIN only — USER is redirected before anything
// is read. Totals are the stored server-computed snapshots.
export default async function PurchasesPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canViewPurchases(session.user)) redirect("/dashboard");

  const locale = await getLocale();
  const [purchases, settings, currency] = await Promise.all([
    db.purchase.findMany({
      where: await warehouseIdFilter(),
      orderBy: { number: "desc" },
      select: { id: true, reference: true, status: true, purchaseDate: true, grandTotal: true, paidAmount: true, createdAt: true, currencyId: true, currency: { select: { code: true, symbol: true } }, supplier: { select: { name: true } }, warehouse: { select: { name: true } } },
    }),
    getSystemSettings(),
    getDefaultCurrency(),
  ]);
  // Completed purchase returns reduce what is owed: Due = Grand Total − Paid − returns.
  const returned = await returnedTotals(purchases.map((p) => p.id));
  const rows: PurchaseRow[] = purchases.map((p) => {
    const grand = p.grandTotal.toFixed(2), paid = p.paidAmount.toFixed(2), ret = returned.get(p.id) ?? "0.00";
    return {
      id: p.id,
      reference: p.reference,
      supplier: p.supplier.name,
      warehouse: p.warehouse.name,
      status: p.status,
      date: p.purchaseDate.toISOString().slice(0, 10),
      grandTotal: grand,
      paid,
      due: purchaseDue(grand, paid, ret),
      paymentStatus: paymentStatus(paid, grand, ret),
      createdOn: formatDateTime(p.createdAt, settings?.dateFormat, locale),
      currency: { code: p.currency.code, symbol: p.currency.symbol, right: !!settings?.currencyIconRight },
      inDefaultCurrency: !!currency && p.currencyId === currency.id,
    };
  });
  return <PurchasesTable canManage={canManagePurchases(session.user)} rows={rows} currency={currency ? { code: currency.code, symbol: currency.symbol, right: currency.right } : null} />;
}
