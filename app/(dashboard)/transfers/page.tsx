import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { canManageTransfers } from "@/lib/roles";
import { getDefaultCurrency, getSystemSettings } from "@/lib/settings";
import { transferTotal, type TransferRow } from "@/lib/transfers";
import TransfersTable from "@/components/transfers/TransfersTable";

export const metadata: Metadata = { title: "Transfers" };

export const instant = false;

// Transfers list (design/Transfers.html). Every signed-in role may view/search the history; only
// OWNER/ADMIN get mutation controls and costs (Grand Total). Server Actions re-check the role.
export default async function TransfersPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const canManage = canManageTransfers(session.user.role);

  const [transfers, settings, currency] = await Promise.all([
    db.stockTransfer.findMany({
      orderBy: { number: "desc" },
      select: {
        id: true,
        reference: true,
        status: true,
        createdAt: true,
        fromWarehouse: { select: { name: true } },
        toWarehouse: { select: { name: true } },
        items: { select: { quantity: true, unitCost: true } },
      },
    }),
    getSystemSettings(),
    canManage ? getDefaultCurrency() : null,
  ]);

  const rows: TransferRow[] = transfers.map((t) => ({
    id: t.id,
    reference: t.reference,
    from: t.fromWarehouse.name,
    to: t.toWarehouse.name,
    items: t.items.length,
    // Costs are never sent to USER.
    total: canManage ? formatMoney(transferTotal(t.items.map((i) => ({ quantity: i.quantity.toFixed(3), unitCost: i.unitCost.toFixed(2) }))), currency) : null,
    status: t.status,
    createdOn: formatDateTime(t.createdAt, settings?.dateFormat),
  }));

  return <TransfersTable rows={rows} canManage={canManage} />;
}
