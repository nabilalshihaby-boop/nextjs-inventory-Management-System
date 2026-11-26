// Server-only: the signed-in user's open held POS orders (summaries for the Held Orders list).
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatQuantity } from "@/lib/money";
import { getSystemSettings } from "@/lib/settings";
import { fromUnits, toUnits } from "@/lib/transfers";
import type { HeldOrderSummary } from "@/lib/pos-held";
import { calcSale } from "@/lib/sales";

export async function getHeldOrders(userId: string): Promise<HeldOrderSummary[]> {
  const [orders, settings] = await Promise.all([
    db.posHeldOrder.findMany({
      where: { createdById: userId, status: "HELD" },
      orderBy: { number: "desc" },
      select: { id: true, revision: true, reference: true, createdAt: true, customerId: true, items: { select: { quantity: true, unitPrice: true, taxType: true, taxRate: true } } },
    }),
    getSystemSettings(),
  ]);
  const ids = [...new Set(orders.map((o) => o.customerId).filter((x): x is string => !!x))];
  const names = new Map((await db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  return orders.map((o) => {
    let qty = BigInt(0);
    for (const i of o.items) qty += toUnits(i.quantity.toFixed(3), 3);
    // The same calculation as checkout, from the HELD terms (a legacy line has no tax snapshot: its price alone).
    const total = calcSale(
      o.items.map((i) => ({ quantity: i.quantity.toFixed(3), unitPrice: i.unitPrice.toFixed(2), taxType: i.taxType ?? ("EXCLUSIVE" as const), taxRate: i.taxRate?.toFixed(2) ?? "0.00", discountType: "FIXED" as const, discountValue: "0.00" })),
      { orderTaxRate: "0.00", discount: "0.00", shipping: "0.00" },
    ).grandTotal;
    return {
      id: o.id,
      revision: o.revision,
      reference: o.reference,
      createdOn: formatDateTime(o.createdAt, settings?.dateFormat),
      lines: o.items.length,
      quantity: formatQuantity(fromUnits(qty, 3)),
      customerName: o.customerId ? (names.get(o.customerId) ?? "Customer no longer exists") : null,
      total,
    };
  });
}
