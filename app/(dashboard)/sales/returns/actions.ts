"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { formatMoney, formatQuantity } from "@/lib/money";
import { canManageSaleReturns } from "@/lib/roles";
import { getSystemSettings } from "@/lib/settings";
import { calcReturn } from "@/lib/purchase-return-calc";
import { formatSaleReturnReference, saleReturnInputSchema, type SaleReturnField } from "@/lib/sale-returns";

// Sales Returns. Integrity rules (server-side, all inside ONE transaction):
// - OWNER/ADMIN only; auth() is re-read and the role never comes from the client.
// - The browser sends only: sale id, sale-line ids + quantities, date, notes (unknown keys are
//   rejected). The sale row is locked (SELECT … FOR UPDATE) first, then the sale, its lines and
//   every earlier return are re-read, so concurrent returns of the same sale are serialized and
//   can never exceed the sold quantity.
// - Only COMPLETED sales can be returned; the return date can't be before the sale date or in the
//   future. Per line: quantity ≤ sold − already returned.
// - Amounts are exact cumulative shares of the sale's stored snapshot (lib/purchase-return-calc.ts):
//   line subtotal/tax/discount, plus the order tax and order discount shared by returned subtotal.
//   Shipping is never returned. Client totals are never used.
// - A return can't exceed the sale's current Due (Grand Total − Paid − earlier returns): refunds /
//   customer credit for paid amounts are a separate future workflow.
// - Stock: every returned quantity is added back to the SALE's warehouse (upsert increment, stable
//   product-id order) in the same transaction. The return lines are the stock movement record.
// - The original sale, its lines and the product master are never modified. NO cash/bank, ledger,
//   refund or payment rows are written. Returns are immutable: there are no edit/delete actions.

export type SaleReturnResult =
  | { ok: true; message: string; id?: string }
  | { ok: false; message: string; fieldErrors?: Partial<Record<SaleReturnField, string>>; itemErrors?: Record<string, string> };

class ReturnError extends Error {
  constructor(message: string, readonly field?: SaleReturnField, readonly itemId?: string) {
    super(message);
  }
}
const fail = (message: string, field?: SaleReturnField, itemId?: string): never => {
  throw new ReturnError(message, field, itemId);
};
const isKnown = (e: unknown, ...codes: string[]) => e instanceof Prisma.PrismaClientKnownRequestError && codes.includes(e.code);
const dateOnly = (v: string) => new Date(`${v}T00:00:00.000Z`);

async function authorize(): Promise<{ userId: string } | { error: SaleReturnResult }> {
  const s = await auth();
  if (!s?.user?.id) return { error: { ok: false, message: "Your session has expired. Please sign in again." } };
  if (!canManageSaleReturns(s.user.role)) return { error: { ok: false, message: "You don't have permission to create sales returns." } };
  return { userId: s.user.id };
}

export async function createSaleReturn(input: unknown): Promise<SaleReturnResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const v = saleReturnInputSchema.safeParse(input);
  if (!v.success) {
    const fieldErrors: Partial<Record<SaleReturnField, string>> = {};
    for (const i of v.error.issues) fieldErrors[(i.path[0] as SaleReturnField) ?? "items"] ??= i.code === "unrecognized_keys" ? "Unexpected fields were sent" : i.message;
    return { ok: false, message: Object.values(fieldErrors)[0] ?? "Please check the form", fieldErrors };
  }
  const d = v.data;
  const settings = await getSystemSettings();

  for (let attempt = 1; ; attempt++) {
    try {
      const created = await db.$transaction(
        async (tx) => {
          // 1. Lock the sale, then re-read it (current committed data only).
          const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sales WHERE id = ${d.saleId} FOR UPDATE`;
          if (!locked.length) fail("Choose a completed sale", "saleId");
          const s = await tx.sale.findUniqueOrThrow({
            where: { id: d.saleId },
            select: {
              id: true, reference: true, status: true, saleDate: true, customerId: true, warehouseId: true, currencyId: true,
              subtotal: true, orderTaxAmount: true, discount: true, grandTotal: true, paidAmount: true,
              currency: { select: { symbol: true } },
              items: { select: { id: true, productId: true, productCode: true, productName: true, unitName: true, quantity: true, unitPrice: true, netUnitPrice: true, taxType: true, taxRate: true, discountType: true, discountValue: true, discountAmount: true, taxAmount: true, subtotal: true } },
            },
          });
          if (s.status !== "COMPLETED") fail(`${s.reference} hasn't been completed, so nothing can be returned from it.`, "saleId");
          if (dateOnly(d.returnDate) < s.saleDate) fail(`The return date can't be before the sale date of ${s.reference}.`, "returnDate");

          // 2. Everything already returned from this sale.
          const [priorByLine, prior] = await Promise.all([
            tx.saleReturnItem.groupBy({ by: ["saleItemId"], where: { saleReturn: { saleId: s.id } }, _sum: { quantity: true } }),
            tx.saleReturn.aggregate({ where: { saleId: s.id }, _sum: { subtotal: true, grandTotal: true } }),
          ]);
          const returnedOf = new Map(priorByLine.map((r) => [r.saleItemId, r._sum.quantity ?? new Prisma.Decimal(0)]));
          const byId = new Map(s.items.map((i) => [i.id, i]));

          // 3. Lines: must belong to this sale and stay within the returnable quantity.
          const lines = d.items.map((it) => {
            const si = byId.get(it.saleItemId) ?? fail("A return line doesn't belong to this sale.", "items", it.saleItemId);
            const returned = returnedOf.get(si.id) ?? new Prisma.Decimal(0);
            const returnable = new Prisma.Decimal(si.quantity).minus(returned);
            if (new Prisma.Decimal(it.quantity).gt(returnable)) {
              fail(`Only ${formatQuantity(returnable.toFixed(3))} of ${si.productCode} ${si.productName} can still be returned (sold ${formatQuantity(si.quantity.toFixed(3))}, already returned ${formatQuantity(returned.toFixed(3))}).`, "items", si.id);
            }
            return { si, quantity: it.quantity, returned: returned.toFixed(3) };
          });

          // 4. Server-side amounts from the sale's stored snapshot.
          const calc = calcReturn(
            { subtotal: s.subtotal.toFixed(2), orderTaxAmount: s.orderTaxAmount.toFixed(2), discount: s.discount.toFixed(2), returnedSubtotal: (prior._sum.subtotal ?? new Prisma.Decimal(0)).toFixed(2) },
            lines.map((l) => ({ original: { quantity: l.si.quantity.toFixed(3), subtotal: l.si.subtotal.toFixed(2), taxAmount: l.si.taxAmount.toFixed(2), discountAmount: l.si.discountAmount.toFixed(2), returned: l.returned }, quantity: l.quantity })),
          );

          // 4b. Refunds / customer credit are NOT built: a return may only reduce what is still unpaid.
          const due = new Prisma.Decimal(s.grandTotal).minus(s.paidAmount).minus(prior._sum.grandTotal ?? 0);
          if (new Prisma.Decimal(calc.grandTotal).gt(due)) {
            const m = (x: Prisma.Decimal) => formatMoney(x.toFixed(2), { code: "", symbol: s.currency.symbol, right: !!settings?.currencyIconRight });
            fail(
              due.gt(0)
                ? `This return is worth ${m(new Prisma.Decimal(calc.grandTotal))} but only ${m(due)} is still unpaid on ${s.reference}. Refunds and customer credit for paid amounts aren't available yet.`
                : `${s.reference} has nothing left unpaid. Returns of paid sales need a customer refund/credit, which isn't available yet.`,
              "items",
            );
          }

          // 5. Add the returned quantities back to the sale's warehouse (stable lock order).
          for (const l of [...lines].sort((x, y) => x.si.productId.localeCompare(y.si.productId))) {
            await tx.productStock.upsert({
              where: { productId_warehouseId: { productId: l.si.productId, warehouseId: s.warehouseId } },
              create: { productId: l.si.productId, warehouseId: s.warehouseId, quantity: l.quantity },
              update: { quantity: { increment: l.quantity } },
            });
          }

          // 6. The immutable return record (+ snapshot lines) with a never-reused reference.
          const r0 = await tx.saleReturn.create({
            data: {
              reference: `TMP_${randomBytes(8).toString("hex")}`, // replaced below, inside this transaction
              returnDate: dateOnly(d.returnDate),
              saleId: s.id,
              customerId: s.customerId,
              warehouseId: s.warehouseId,
              currencyId: s.currencyId,
              subtotal: calc.subtotal,
              orderTaxAmount: calc.orderTaxAmount,
              discount: calc.discount,
              shipping: calc.shipping,
              grandTotal: calc.grandTotal,
              notes: d.notes || null,
              createdById: a.userId,
              items: {
                create: lines.map((l, n) => ({
                  saleItemId: l.si.id,
                  productId: l.si.productId,
                  productCode: l.si.productCode,
                  productName: l.si.productName,
                  unitName: l.si.unitName,
                  quantity: l.quantity,
                  unitPrice: l.si.unitPrice,
                  netUnitPrice: l.si.netUnitPrice,
                  taxType: l.si.taxType,
                  taxRate: l.si.taxRate,
                  discountType: l.si.discountType,
                  discountValue: l.si.discountValue,
                  discountAmount: calc.lines[n].discountAmount,
                  taxAmount: calc.lines[n].taxAmount,
                  subtotal: calc.lines[n].subtotal,
                })),
              },
            },
            select: { id: true, number: true },
          });
          const reference = formatSaleReturnReference(r0.number);
          await tx.saleReturn.update({ where: { id: r0.id }, data: { reference } });
          return { id: r0.id, reference, saleId: s.id, saleRef: s.reference };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 },
      );
      revalidatePath("/sales/returns");
      revalidatePath("/sales");
      revalidatePath(`/sales/${created.saleId}`);
      revalidatePath("/products");
      return { ok: true, message: `Sale return ${created.reference} created — stock added back and the due of ${created.saleRef} reduced`, id: created.id };
    } catch (e) {
      if (e instanceof ReturnError) return { ok: false, message: e.message, fieldErrors: e.field ? { [e.field]: e.message } : undefined, itemErrors: e.itemId ? { [e.itemId]: e.message } : undefined };
      if (attempt < 4 && isKnown(e, "P2034", "P2002")) continue; // deadlock / new stock-row race → retry
      if (isKnown(e, "P2003")) return { ok: false, message: "The sale or a product no longer exists. Refresh and try again." };
      throw e;
    }
  }
}
