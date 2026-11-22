"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { baselineTotalCents, getUncostedStock, hasLaterCostedActivity } from "@/lib/opening-cost";
import { canSetCostBaseline } from "@/lib/roles";
import { fromUnits } from "@/lib/transfers";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";

// Owner-only Opening Inventory Cost Setup. The browser may send ONLY a currency id and, per product, a cost per Base Unit:
// the payload is a strict schema, so a forged quantity, total, date, user or role field is rejected outright. The server
// decides everything else — which products are eligible, their quantity, the total value, the cutover moment (its own
// clock) and who created it (the session). The one and only write is the InventoryCostBaseline record: no stock quantity,
// purchase, payment, expense, sale, cash/bank row or stock movement is ever touched.

export type BaselineResult = { ok: true; message: string } | { ok: false; message: string };

const idSchema = z.string().trim().min(1).max(64);
const payloadSchema = z.strictObject({
  currencyId: idSchema,
  items: z
    .array(z.strictObject({ productId: idSchema, unitCost: z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/) }))
    .min(1)
    .max(500),
});
const MAX_CENTS = BigInt("99999999999999"); // DECIMAL(14,2)

async function authorize() {
  const t = await getDict();
  const session = await auth();
  if (!session?.user?.id) return { t, denied: { ok: false, message: t.common.sessionExpired } as BaselineResult, userId: "" };
  if (!canSetCostBaseline(session.user.role)) return { t, denied: { ok: false, message: t.costSetup.err.noPermission } as BaselineResult, userId: "" };
  return { t, denied: null, userId: session.user.id };
}

export async function saveCostBaseline(input: unknown): Promise<BaselineResult> {
  const { t, denied, userId } = await authorize();
  if (denied) return denied;
  const E = t.costSetup.err;
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues.some((i) => i.path[0] === "items" && i.code === "too_small") ? E.nothing : E.invalid };
  const { currencyId, items } = parsed.data;
  if (new Set(items.map((i) => i.productId)).size !== items.length) return { ok: false, message: E.invalid };

  const currency = await db.currency.findUnique({ where: { id: currencyId }, select: { id: true } });
  if (!currency) return { ok: false, message: E.currency };
  const settings = await db.systemSettings.findUnique({ where: { id: 1 }, select: { defaultCurrencyId: true } });

  const now = new Date(); // the cutover moment is the SERVER's clock — never supplied by the browser
  try {
    const saved = await db.$transaction(
      async (tx) => {
        // Freeze the chosen products' stock while the eligible quantity is read (every stock write takes this same row lock).
        await tx.$queryRaw`SELECT id FROM product_stocks WHERE productId IN (${Prisma.join(items.map((i) => i.productId))}) FOR UPDATE`;
        const eligible = new Map((await getUncostedStock(tx, currencyId, settings?.defaultCurrencyId ?? null)).map((r) => [r.productId, r]));
        const rows = items.map((i) => {
          const r = eligible.get(i.productId);
          if (!r) throw new Rejected(E.notEligible);
          const total = baselineTotalCents(r.uncosted, i.unitCost);
          if (total > MAX_CENTS) throw new Rejected(E.tooBig);
          return { productId: i.productId, quantity: r.uncosted, unitCost: i.unitCost, totalValue: fromUnits(total, 2) };
        });
        for (const r of rows) await tx.inventoryCostBaseline.create({ data: { ...r, currencyId, effectiveAt: now, createdAt: now, createdById: userId } });
        return rows.length;
      },
      { isolationLevel: "ReadCommitted" },
    );
    revalidatePath("/profit-loss/setup");
    revalidatePath("/reports/profit-loss");
    return { ok: true, message: fmt(t.costSetup.ok.saved, { count: saved }) };
  } catch (e) {
    if (e instanceof Rejected) return { ok: false, message: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, message: E.notEligible }; // a baseline appeared meanwhile
    throw e;
  }
}

/** Undo (remove) a baseline — only while no later costed inventory activity exists for its product. Otherwise corrections are deferred. */
export async function undoCostBaseline(id: unknown): Promise<BaselineResult> {
  const { t, denied } = await authorize();
  if (denied) return denied;
  const E = t.costSetup.err;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: E.invalid };
  try {
    await db.$transaction(
      async (tx) => {
        const b = await tx.inventoryCostBaseline.findUnique({ where: { id: parsed.data } });
        if (!b) throw new Rejected(E.notFound);
        await tx.$queryRaw`SELECT id FROM product_stocks WHERE productId = ${b.productId} FOR UPDATE`;
        if (await hasLaterCostedActivity(tx, b.productId, b.effectiveAt)) throw new Rejected(E.locked);
        await tx.inventoryCostBaseline.delete({ where: { id: b.id } });
      },
      { isolationLevel: "ReadCommitted" },
    );
    revalidatePath("/profit-loss/setup");
    revalidatePath("/reports/profit-loss");
    return { ok: true, message: t.costSetup.ok.undone };
  } catch (e) {
    if (e instanceof Rejected) return { ok: false, message: e.message };
    throw e;
  }
}

class Rejected extends Error {}
