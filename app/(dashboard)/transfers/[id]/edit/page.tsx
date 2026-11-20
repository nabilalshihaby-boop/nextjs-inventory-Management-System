import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatQuantity } from "@/lib/money";
import { canManageTransfers } from "@/lib/roles";
import { getTransferFormData, todayIso } from "@/lib/transfer-options";
import TransferForm from "@/components/transfers/TransferForm";

export const metadata: Metadata = { title: "Edit Transfer" };

export const instant = false;

// Edit Transfer (design/Create Transfer.html, pre-filled). OWNER/ADMIN only, PENDING transfers only:
// sent/completed transfers are inventory history and go to the read-only details page instead.
export default async function EditTransferPage({ params }: PageProps<"/transfers/[id]/edit">) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!canManageTransfers(session.user.role)) redirect("/transfers");

  const { id } = await params;
  const t = await db.stockTransfer.findUnique({
    where: { id },
    select: {
      id: true,
      reference: true,
      transferDate: true,
      fromWarehouseId: true,
      toWarehouseId: true,
      status: true,
      note: true,
      items: {
        orderBy: { id: "asc" },
        select: { quantity: true, product: { select: { id: true, code: true, name: true, cost: true, productUnit: { select: { name: true } } } } },
      },
    },
  });
  if (!t) notFound();
  if (t.status !== "PENDING") redirect(`/transfers/${encodeURIComponent(t.id)}`);

  const data = await getTransferFormData();
  return (
    <TransferForm
      {...data}
      today={todayIso()}
      transferId={t.id}
      reference={t.reference}
      initial={{
        transferDate: t.transferDate.toISOString().slice(0, 10),
        fromWarehouseId: t.fromWarehouseId,
        toWarehouseId: t.toWarehouseId,
        status: t.status,
        note: t.note ?? "",
        items: t.items.map((i) => ({ productId: i.product.id, quantity: formatQuantity(i.quantity.toFixed(3)).replace(/,/g, "") })),
      }}
      // Lines keep showing even if the product's stock has since dropped to 0 (flagged on save).
      initialLines={t.items.map((i) => ({
        productId: i.product.id,
        code: i.product.code,
        name: i.product.name,
        unit: i.product.productUnit.name,
        cost: i.product.cost.toFixed(2),
      }))}
    />
  );
}
