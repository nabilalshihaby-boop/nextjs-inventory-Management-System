// Server-only: the signed-in user's open held POS orders (summaries for the Held Orders list).
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatQuantity } from "@/lib/money";
import { getSystemSettings } from "@/lib/settings";
import { fromUnits, toUnits } from "@/lib/transfers";
import type { HeldOrderSummary } from "@/lib/pos-held";

export async function getHeldOrders(userId: string): Promise<HeldOrderSummary[]> {
  const [orders, settings] = await Promise.all([
    db.posHeldOrder.findMany({
      where: { createdById: userId, status: "HELD" },
      orderBy: { number: "desc" },
      select: { id: true, reference: true, createdAt: true, customerId: true, items: { select: { quantity: true, unitPrice: true } } },
    }),
    getSystemSettings(),
  ]);
  const ids = [...new Set(orders.map((o) => o.customerId).filter((x): x is string => !!x))];
  const names = new Map((await db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  return orders.map((o) => {
    let qty = BigInt(0), value = BigInt(0);
    for (const i of o.items) {
      const q = toUnits(i.quantity.toFixed(3), 3);
      qty += q;
      value += (q * toUnits(i.unitPrice.toFixed(2), 2) + BigInt(500)) / BigInt(1000);
    }
    return {
      id: o.id,
      reference: o.reference,
      createdOn: formatDateTime(o.createdAt, settings?.dateFormat),
      lines: o.items.length,
      quantity: formatQuantity(fromUnits(qty, 3)),
      customerName: o.customerId ? (names.get(o.customerId) ?? "Customer no longer exists") : null,
      total: fromUnits(value, 2),
    };
  });
}
