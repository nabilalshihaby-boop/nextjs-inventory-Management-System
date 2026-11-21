import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatQuantity } from "@/lib/money";
import { canManageAdjustments } from "@/lib/roles";
import { getAdjustmentFormData } from "@/lib/adjustment-options";
import { todayIso } from "@/lib/transfer-options";
import { getDict } from "@/lib/i18n/server";
import AdjustmentForm from "@/components/adjustments/AdjustmentForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).adjustments.editTitle };
}

export const instant = false;

// Edit Adjustment (design/Create Adjustment.html, pre-filled). OWNER/ADMIN only. Saving reverses
// the original stock effect and applies the new one in one transaction.
export default async function EditAdjustmentPage({ params }: PageProps<"/adjustments/[id]/edit">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageAdjustments(session.user.role)) redirect("/adjustments");

  const { id } = await params;
  const a = await db.stockAdjustment.findUnique({
    where: { id },
    select: { id: true, reference: true, warehouseId: true, adjustmentDate: true, items: { orderBy: { id: "asc" }, select: { productId: true, quantity: true, type: true } } },
  });
  if (!a) notFound();

  return (
    <AdjustmentForm
      {...await getAdjustmentFormData()}
      today={todayIso()}
      adjustmentId={a.id}
      reference={a.reference}
      initial={{
        warehouseId: a.warehouseId,
        adjustmentDate: a.adjustmentDate.toISOString().slice(0, 10),
        items: a.items.map((i) => ({ productId: i.productId, quantity: formatQuantity(i.quantity.toFixed(3)).replace(/,/g, ""), type: i.type })),
      }}
    />
  );
}
