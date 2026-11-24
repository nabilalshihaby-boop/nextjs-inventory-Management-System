import { warehouseIdFilter } from "@/lib/access-scope";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatDateOnly } from "@/lib/format";
import { getDict } from "@/lib/i18n/server";
import { formatQuantity } from "@/lib/money";
import { canManageAdjustments } from "@/lib/roles";
import { getSystemSettings } from "@/lib/settings";
import type { AdjustmentRow } from "@/lib/adjustments";
import AdjustmentsTable from "@/components/adjustments/AdjustmentsTable";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).adjustments.title };
}

export const instant = false;

// Adjustments list (design/Adjustments.html). Every signed-in role may view/search the history;
// only OWNER/ADMIN get Create / Edit / Delete (and the Server Actions re-check that).
export default async function AdjustmentsPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const [adjustments, settings] = await Promise.all([
    db.stockAdjustment.findMany({
      where: await warehouseIdFilter(),
      orderBy: { number: "desc" },
      select: {
        id: true,
        reference: true,
        adjustmentDate: true,
        warehouse: { select: { name: true } },
        items: { orderBy: { id: "asc" }, select: { quantity: true, type: true, unitName: true, product: { select: { code: true, name: true, productUnit: { select: { name: true } } } } } },
      },
    }),
    getSystemSettings(),
  ]);

  const rows: AdjustmentRow[] = adjustments.map((a) => ({
    id: a.id,
    reference: a.reference,
    warehouse: a.warehouse.name,
    date: formatDateOnly(a.adjustmentDate, settings?.dateFormat),
    lines: a.items.map((i) => ({ product: i.product.name, code: i.product.code, type: i.type, quantity: formatQuantity(i.quantity.toFixed(3)), unit: i.unitName ?? i.product.productUnit.name })),
  }));

  return <AdjustmentsTable rows={rows} canManage={canManageAdjustments(session.user)} />;
}
