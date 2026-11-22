"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { todayLocal } from "@/lib/cash-bank";
import { LedgerError, ledgerFail, appendLedgerRow, dateOnly, ledgerTxOptions, lockAccounts } from "@/lib/cash-bank-ledger";
import { CUSTOMER_PAYMENT_PURPOSE, formatCustomerPaymentReference } from "@/lib/customer-payments";
import { posCheckoutSchema } from "@/lib/pos";
import { getDict } from "@/lib/i18n/server";
import { errorMessage, tr } from "@/lib/i18n/messages";
import { canUsePos } from "@/lib/roles";
import { calcSale, formatSaleReference } from "@/lib/sales";
import { SaleError, deductStock } from "@/lib/sale-stock";
import { StockHistoryError } from "@/lib/stock-history-guard";
import { getDefaultCurrency } from "@/lib/settings";
import { fromUnits, toUnits } from "@/lib/transfers";

// POS checkout — NOT a separate sales system: it creates a normal COMPLETED Sale (SA_ reference,
// immutable line snapshots), deducts stock with the shared deductStock(), and records the normal
// Customer Payment + allocation + ONE Cash/Bank DEPOSIT (purpose "Customer Collection"), all in ONE
// READ COMMITTED transaction. Server-side rules:
// - OWNER/ADMIN only; auth() is re-read here (never the client), unknown payload keys are rejected.
// - The payload carries ids, quantities, method, account, notes and the checkout key ONLY. Prices,
//   tax, totals, currency, the date (server "today") and the paid amount are all server-owned;
//   Paid = Grand Total, so Due = 0 and the sale is fully paid. No discount/shipping/order tax.
// - Split payment: 1-5 tenders (method + account + exact amount) must add up to the Grand Total exactly; each becomes a normal
//   Customer Payment + allocation + one Cash/Bank deposit, all in this one transaction (all-or-nothing).
// - Register sessions: a CASH tender requires an OPEN register on that CASH account; it is linked to it (immutably) in this same transaction.
// - Idempotency: Sale.posCheckoutKey is UNIQUE and is written by the FIRST statement of the
//   transaction, so a concurrent duplicate blocks on that unique index and, once the first commits,
//   fails with P2002 and rolls back whole (no stock, payment or ledger effect). A retry of a finished
//   checkout by the same user returns the original sale and writes nothing; another user's key is
//   refused. The key never authorizes any business value.
// - Stock is re-read under the transaction by a conditional UPDATE … WHERE quantity >= n; any
//   shortage rolls the whole checkout back. The account is locked and must be ACTIVE and in the
//   sale currency. Products, prior sales/payments and ledger rows are never modified.
// - Walk-in: the optional walkIn flag is only a claim; the configured setting is re-read in the transaction and a mismatch rejects the checkout.
// - A held order (optional heldOrderId) is marked CONSUMED in the same transaction, so it can't be reused.

export type PosCheckoutResult =
  | { ok: true; message: string; saleId: string; reference: string; replayed: boolean }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

const isKnown = (e: unknown, ...codes: string[]) => e instanceof Prisma.PrismaClientKnownRequestError && codes.includes(e.code);
const MAX_TOTAL = toUnits("999999999999.99", 2);
// Rejects with a dictionary key (English text derived from en.ts); the catch block translates it.
const reject = (key: string, vars: Record<string, string | number> = {}, field?: string): never => ledgerFail(key, vars, field);

export async function posCheckout(input: unknown): Promise<PosCheckoutResult> {
  const session = await auth();
  const dict = await getDict();
  if (!session?.user?.id) return { ok: false, message: dict.common.sessionExpired };
  if (!canUsePos(session.user.role)) return { ok: false, message: dict.pos.noPermission };
  const userId = session.user.id;

  const v = posCheckoutSchema.safeParse(input);
  if (!v.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of v.error.issues) fieldErrors[String(i.path[0] ?? "items")] ??= i.code === "unrecognized_keys" ? dict.common.unexpectedFields : i.message.startsWith("posTx.") ? tr(dict, i.message) : i.message;
    return { ok: false, message: Object.values(fieldErrors)[0] ?? "Please check the checkout", fieldErrors };
  }
  const d = v.data;

  // A finished checkout with this key: replay it (idempotent), never repeat any effect.
  const replay = async (): Promise<PosCheckoutResult | null> => {
    const s = await db.sale.findUnique({ where: { posCheckoutKey: d.checkoutKey }, select: { id: true, reference: true, createdById: true } });
    if (!s) return null;
    if (s.createdById !== userId) return { ok: false, message: dict.posTx.checkout.keyInvalid };
    return { ok: true, message: tr(dict, "posTx.checkout.replay", { ref: s.reference }), saleId: s.id, reference: s.reference, replayed: true };
  };
  const again = await replay();
  if (again) return again;

  const currency = await getDefaultCurrency();
  if (!currency) return { ok: false, message: dict.posTx.checkout.noCurrency };

  for (let attempt = 1; ; attempt++) {
    try {
      const created = await db.$transaction(async (tx) => {
        const [customer, warehouse, products] = await Promise.all([
          tx.customer.findUnique({ where: { id: d.customerId }, select: { id: true, name: true } }),
          tx.warehouse.findUnique({ where: { id: d.warehouseId }, select: { id: true } }),
          tx.product.findMany({ where: { id: { in: d.items.map((i) => i.productId) } }, select: { id: true, code: true, name: true, price: true, taxType: true, orderTax: true, saleUnit: { select: { name: true } } } }),
        ]);
        if (!customer) return reject("posTx.checkout.chooseCustomer", {}, "customerId");
        if (d.walkIn) {
          // Walk-in checkout: the setting is re-read here; it must still name exactly this customer.
          const cfg = await tx.systemSettings.findUnique({ where: { id: 1 }, select: { posWalkInCustomerId: true } });
          if (!cfg?.posWalkInCustomerId || cfg.posWalkInCustomerId !== customer.id) return reject("posTx.checkout.walkInChanged", {}, "customerId");
        }
        if (!warehouse) return reject("posTx.checkout.chooseWarehouse", {}, "warehouseId");
        const byId = new Map(products.map((p) => [p.id, p]));
        if (d.items.some((i) => !byId.has(i.productId))) return reject("posTx.checkout.productGone", {}, "items");

        // Authoritative totals from the STORED product values (same exact calculation as Sales).
        const lines = d.items.map((i) => {
          const p = byId.get(i.productId)!;
          return { quantity: i.quantity, unitPrice: p.price.toFixed(2), taxType: p.taxType, taxRate: p.orderTax.toFixed(2), discountType: "FIXED" as const, discountValue: "0.00" };
        });
        const totals = calcSale(lines, { orderTaxRate: "0.00", discount: "0.00", shipping: "0.00" });
        const bad = totals.lines.find((l) => l.error);
        if (bad || totals.error) return reject(bad?.errorKey ?? totals.errorKey ?? "posTx.checkout.invalidTotals", {}, "items");
        const grand = toUnits(totals.grandTotal, 2);
        if (grand <= BigInt(0)) return reject("posTx.checkout.totalZero", {}, "items");
        if (grand > MAX_TOTAL || toUnits(totals.subtotal, 2) > MAX_TOTAL) return reject("posTx.checkout.totalLarge", {}, "items");

        const today = dateOnly(todayLocal());
        // 1. The sale — FIRST statement: claims the unique checkout key (a duplicate blocks here).
        const at = new Date(); // the completion moment (stock-out time)
        const s0 = await tx.sale.create({
          data: {
            reference: `TMP_${randomBytes(8).toString("hex")}`,
            posCheckoutKey: d.checkoutKey,
            saleDate: today,
            customer: { connect: { id: customer.id } },
            warehouse: { connect: { id: warehouse.id } },
            status: "COMPLETED",
            currency: { connect: { id: currency.id } },
            subtotal: totals.subtotal,
            orderTaxRate: "0",
            orderTaxAmount: totals.orderTaxAmount,
            discount: "0",
            shipping: "0",
            grandTotal: totals.grandTotal,
            paidAmount: totals.grandTotal,
            notes: d.notes || null,
            createdById: userId,
            completedAt: at,
            completedById: userId,
            items: {
              create: d.items.map((i, n) => {
                const p = byId.get(i.productId)!;
                return {
                  product: { connect: { id: p.id } },
                  productCode: p.code,
                  productName: p.name,
                  unitName: p.saleUnit.name,
                  quantity: i.quantity,
                  unitPrice: lines[n].unitPrice,
                  taxType: lines[n].taxType,
                  taxRate: lines[n].taxRate,
                  discountType: "FIXED" as const,
                  discountValue: "0",
                  discountAmount: totals.lines[n].discountAmount,
                  taxAmount: totals.lines[n].taxAmount,
                  netUnitPrice: totals.lines[n].netUnitCost,
                  subtotal: totals.lines[n].subtotal,
                };
              }),
            },
          },
          select: { id: true, number: true },
        });
        const reference = formatSaleReference(s0.number);
        await tx.sale.update({ where: { id: s0.id }, data: { reference } });

        // 1b. A resumed held order is consumed by THIS checkout (conditional update → can't be reused;
        // a second concurrent checkout of the same order blocks on the row, then fails and rolls back).
        if (d.heldOrderId) {
          const used = await tx.posHeldOrder.updateMany({ where: { id: d.heldOrderId, createdById: userId, status: "HELD" }, data: { status: "CONSUMED", consumedSaleId: s0.id } });
          if (used.count !== 1) reject("posTx.checkout.heldUsed", {}, "heldOrderId");
        }

        // 2. Stock — conditional, once, all-or-nothing.
        await deductStock(tx, warehouse.id, d.items.map((i) => ({ productId: i.productId, quantity: i.quantity, productCode: byId.get(i.productId)!.code, productName: byId.get(i.productId)!.name })), at);

        // 3. Tender check — the payments must add up to EXACTLY the server-calculated Grand Total
        // (no partial, no change). Every receiving account is locked (id order), ACTIVE and in the sale currency.
        const tenderSum = d.tenders.reduce((n, t) => n + toUnits(t.amount, 2), BigInt(0));
        if (tenderSum !== grand) return reject("posTx.checkout.tendersSum", { paid: fromUnits(tenderSum, 2), total: totals.grandTotal }, "tenders");
        const accounts = await lockAccounts(tx, d.tenders.map((t) => t.cashBankAccountId));
        for (const t of d.tenders) {
          const acc = accounts.get(t.cashBankAccountId) ?? reject("posTx.checkout.chooseCashBank", {}, "tenders");
          if (acc.status !== "ACTIVE") reject("finance.err.inactiveUse", { name: acc.name }, "tenders");
          if (acc.currencyId !== currency.id) reject("posTx.checkout.differentCurrency", { name: acc.name }, "tenders");
        }
        // 3b. Register sessions: every CASH tender must go into a CASH account that has an OPEN register.
        // The session row is locked (checkout and Close Register serialize on it), so a session that is
        // closing/closed can never receive a tender; any failure rolls back the whole checkout.
        const sessionOf = new Map<string, string>();
        for (const t of d.tenders) {
          if (t.paymentMethod !== "Cash") continue;
          const acc = accounts.get(t.cashBankAccountId)!;
          if (acc.type !== "CASH") reject("posTx.checkout.cashOnly", { name: acc.name }, "tenders");
          if (!sessionOf.has(acc.id)) {
            const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM cash_register_sessions WHERE cashBankAccountId = ${acc.id} AND status = 'OPEN' FOR UPDATE`;
            if (!rows.length) reject("posTx.checkout.openRegister", { name: acc.name }, "tenders");
            sessionOf.set(acc.id, rows[0].id);
          }
        }

        // 4+5. One normal Customer Payment + allocation to THIS sale + ONE linked Cash/Bank deposit per tender.
        const payRefs: string[] = [];
        const ledgerRefs: string[] = [];
        for (const [n, t] of d.tenders.entries()) {
          const acc = accounts.get(t.cashBankAccountId)!;
          const p0 = await tx.customerPayment.create({
            data: {
              reference: `TMP_${randomBytes(8).toString("hex")}`,
              paymentDate: today,
              customerId: customer.id,
              cashBankAccountId: acc.id,
              currencyId: acc.currencyId,
              amount: t.amount,
              paymentMethod: t.paymentMethod,
              registerSessionId: t.paymentMethod === "Cash" ? sessionOf.get(acc.id) : undefined,
              notes: d.tenders.length > 1 ? `POS checkout ${reference} · payment ${n + 1} of ${d.tenders.length}` : `POS checkout ${reference}`,
              createdById: userId,
              allocations: { create: { saleId: s0.id, amount: t.amount } },
            },
            select: { id: true, number: true },
          });
          const payRef = formatCustomerPaymentReference(p0.number);
          await tx.customerPayment.update({ where: { id: p0.id }, data: { reference: payRef } });
          const dep = await appendLedgerRow(tx, "DEPOSIT", {
            transactionDate: today,
            accountId: acc.id,
            amount: t.amount,
            paymentMethod: t.paymentMethod,
            purpose: CUSTOMER_PAYMENT_PURPOSE,
            notes: `${payRef} · ${customer.name} · ${reference} · POS`,
            createdById: userId,
            customerPaymentId: p0.id,
          });
          payRefs.push(payRef);
          ledgerRefs.push(dep.reference);
        }
        return { id: s0.id, reference, payRef: payRefs.join(", "), ledger: ledgerRefs.join(", ") };
      }, ledgerTxOptions);
      revalidatePath("/sales");
      revalidatePath(`/sales/${created.id}`);
      revalidatePath("/customer-payments");
      revalidatePath("/finance/accounts");
      revalidatePath("/finance/transactions");
      revalidatePath("/products"); // In Stock
      return { ok: true, message: tr(dict, "posTx.checkout.done", { ref: created.reference, pay: created.payRef, ledger: created.ledger }), saleId: created.id, reference: created.reference, replayed: false };
    } catch (e) {
            if (e instanceof LedgerError) {
        const message = e.i18n ? tr(dict, e.i18n.key, e.i18n.vars) : e.message;
        return { ok: false, message, fieldErrors: e.field ? { [e.field]: message } : undefined };
      }
      if (e instanceof SaleError || e instanceof StockHistoryError) {
        const m = errorMessage(dict, e);
        return { ok: false, message: m, fieldErrors: { items: m } };
      }
      if (isKnown(e, "P2002")) {
        // A concurrent request with the same checkout key committed first → replay it.
        const r = await replay();
        if (r) return r;
        throw e;
      }
      if (attempt < 4 && isKnown(e, "P2034")) continue; // deadlock / write conflict → retry
      if (isKnown(e, "P2003")) return { ok: false, message: dict.posTx.checkout.refsGone };
      throw e;
    }
  }
}
