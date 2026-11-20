import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { canManagePurchaseReturns } from "@/lib/roles";
import { getDefaultCurrency, getSystemSettings } from "@/lib/settings";
import type { PurchaseReturnRow } from "@/lib/purchase-returns";
import PurchaseReturnsTable from "@/components/purchases/PurchaseReturnsTable";

export const metadata: Metadata = { title: "Purchases Returns" };

export const instant = false;

// Purchases Returns list (design/Purchases Returns.html). OWNER/ADMIN only — USER is redirected
// before anything is read. Amounts are the stored server-computed snapshots.
export default async function PurchaseReturnsPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManagePurchaseReturns(session.user.role)) redirect("/dashboard");

  const [returns, settings, currency] = await Promise.all([
    db.purchaseReturn.findMany({
      orderBy: { number: "desc" },
      select: { id: true, reference: true, returnDate: true, grandTotal: true, createdAt: true, currencyId: true, currency: { select: { code: true, symbol: true } }, purchase: { select: { reference: true } }, supplier: { select: { name: true } }, warehouse: { select: { name: true } } },
    }),
    getSystemSettings(),
    getDefaultCurrency(),
  ]);
  const rows: PurchaseReturnRow[] = returns.map((r) => ({
    id: r.id,
    reference: r.reference,
    purchaseRef: r.purchase.reference,
    supplier: r.supplier.name,
    warehouse: r.warehouse.name,
    date: r.returnDate.toISOString().slice(0, 10),
    grandTotal: r.grandTotal.toFixed(2),
    currency: { code: r.currency.code, symbol: r.currency.symbol, right: !!settings?.currencyIconRight },
    inDefaultCurrency: !!currency && r.currencyId === currency.id,
    createdOn: formatDateTime(r.createdAt, settings?.dateFormat),
  }));
  return <PurchaseReturnsTable rows={rows} />;
}
