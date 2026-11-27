"use server";

import { InactiveProductError, assertKeptLines, assertProductsActive, sameDecimal, sameUnit } from "@/lib/product-status";
import { scopeError } from "@/lib/access-scope";
import { randomBytes } from "node:crypto";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { holdOrderSchema, heldIdSchema, heldRevisionSchema, type HeldOrderSummary, type ResumedOrder } from "@/lib/pos-held";
import { getHeldOrders } from "@/lib/pos-held-data";
import { hasSnapshot, heldUnit, loadUnitSets, pickUnit, resolveLine } from "@/lib/product-units";
import { scalePrice, trimFactor } from "@/lib/unit-math";
import { getDict } from "@/lib/i18n/server";
import { errorMessage, tr } from "@/lib/i18n/messages";
import type { Dictionary } from "@/lib/i18n";
import { canUsePos } from "@/lib/roles";
import { getDefaultCurrency } from "@/lib/settings";
import { fromUnits, toUnits } from "@/lib/transfers";

// Held POS orders. A held order is a DRAFT: these actions only touch pos_held_orders /
// pos_held_order_items — never sales, payments, ledger, stock, customers or products.
// - OWNER/ADMIN only; auth() is re-read in every action (the role and user id never come from the client).
// - Only the creator can list/resume/discard/update an order; any other id looks like "not found"
//   (nothing about other users' orders is revealed).
// - Hold is idempotent: holdKey is UNIQUE, so a double-click/retry returns the first order.
// - A NEW hold merges duplicate product lines (exact BigInt sums); a re-hold never merges. Resume re-validates every reference but
//   reserves nothing; checkout (posCheckout) re-reads products and stock again, as always.
// - Optimistic concurrency: every change adds 1 to the order's revision. Re-hold, discard and checkout lock the order and refuse a request
//   whose revision isn't the stored one, writing nothing. A re-hold that changes nothing writes nothing.

export type HoldResult = { ok: true; message: string; id: string; reference: string; orders: HeldOrderSummary[] } | { ok: false; message: string; conflict?: boolean };
export type ResumeResult = { ok: true; order: ResumedOrder } | { ok: false; message: string };
export type DiscardResult = { ok: true; message: string; orders: HeldOrderSummary[] } | { ok: false; message: string; conflict?: boolean };

const MAX_OPEN_HELD = 50;

const isKnown = (e: unknown, ...codes: string[]) => e instanceof Prisma.PrismaClientKnownRequestError && codes.includes(e.code);

async function authorize(): Promise<{ userId: string; t: Dictionary } | { error: { ok: false; message: string } }> {
  const s = await auth();
  const t = await getDict();
  if (!s?.user?.id) return { error: { ok: false, message: t.common.sessionExpired } };
  if (!canUsePos(s.user)) return { error: { ok: false, message: t.pos.noPermission } };
  return { userId: s.user.id, t };
}

export async function listHeldOrders(): Promise<{ ok: true; orders: HeldOrderSummary[] } | { ok: false; message: string }> {
  const a = await authorize();
  if ("error" in a) return a.error;
  return { ok: true, orders: await getHeldOrders(a.userId) };
}

export async function holdPosOrder(input: unknown): Promise<HoldResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const t = a.t;
  const v = holdOrderSchema.safeParse(input);
  if (!v.success) return { ok: false, message: v.error.issues[0]?.code === "unrecognized_keys" ? t.common.unexpectedFields : (v.error.issues[0]?.message.startsWith("posTx.") ? tr(t, v.error.issues[0].message) : (v.error.issues[0]?.message ?? t.common.checkForm)) };
  const d = v.data;
  if (d.warehouseId) {
    const scopeMsg = await scopeError([d.warehouseId]);
    if (scopeMsg) return { ok: false, message: scopeMsg };
  }

  const productIds = [...new Set(d.items.map((i) => i.productId))];

  const accountIds = [...new Set(d.tenders.map((t) => t.cashBankAccountId).filter(Boolean))];
  const [products, customer, warehouse, accountRows] = await Promise.all([
    db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, code: true, name: true } }),
    d.customerId ? db.customer.findUnique({ where: { id: d.customerId }, select: { id: true } }) : Promise.resolve(true),
    d.warehouseId ? db.warehouse.findUnique({ where: { id: d.warehouseId }, select: { id: true } }) : Promise.resolve(true),
    accountIds.length ? db.cashBankAccount.findMany({ where: { id: { in: accountIds } }, select: { id: true } }) : Promise.resolve([]),
  ]);
  const byId = new Map(products.map((p) => [p.id, p]));
  if (productIds.some((pid) => !byId.has(pid))) return { ok: false, message: t.posTx.held.productGone };
  if (!customer) return { ok: false, message: t.posTx.held.customerGone };
  if (!warehouse) return { ok: false, message: t.posTx.held.warehouseGone };
  if (accountRows.length !== accountIds.length) return { ok: false, message: t.posTx.held.accountGone };

  // A held line is a product UNIT: the same product may be held once per unit. Its unit must be an active SALE unit of the product (blank =
  // default), and its price, tax type and rate, unit name, factor and base quantity are SNAPSHOT with it, all from the database. When an
  // order is held again a line is an existing one ONLY if it names that line's id (`heldLineId`) and the SERVER finds it on this order with
  // the same product and unit: with a complete snapshot it keeps its price, tax and factor (a new quantity only recomputes the base
  // quantity). A line without an id is new and takes the current ones, even if the order held the same product and unit before. An id that
  // is unknown, from another order, repeated or on another product/unit refuses the whole request.
  type Stored = { id: string; productId: string; unitId: string | null; unitName: string | null; unitFactor: Prisma.Decimal | null; baseQuantity: Prisma.Decimal | null; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; taxType: "EXCLUSIVE" | "INCLUSIVE" | null; taxRate: Prisma.Decimal | null };
  type Row = { id?: string; productId: string; productCode: string; productName: string; quantity: string; unitId: string; unitPrice: string; unitName: string; unitFactor: string; baseQuantity: string; taxType: "EXCLUSIVE" | "INCLUSIVE"; taxRate: string };
  const storedSelect = { warehouseId: true, customerId: true, notes: true, cashBankAccountId: true, paymentMethod: true, tenders: { orderBy: { position: "asc" }, select: { paymentMethod: true, cashBankAccountId: true, amount: true } }, items: { select: { productCode: true, productName: true, id: true, productId: true, unitId: true, unitName: true, unitFactor: true, baseQuantity: true, quantity: true, unitPrice: true, taxType: true, taxRate: true } } } as const;

  /** The lines to store, resolved INSIDE the writing transaction against the order's current stored lines (nothing is written here). */
  async function buildRows(tx: Prisma.TransactionClient, previous: { warehouseId: string | null; items: Stored[] } | null): Promise<{ rows: Row[] } | { refused: string }> {
    // Which stored line each submitted line is (undefined = a new line). Checked before anything else.
    const storedById = new Map((previous?.items ?? []).map((s) => [s.id, s]));
    const used = new Set<string>();
    const source: (Stored | undefined)[] = [];
    for (const i of d.items) {
      const s = i.heldLineId === undefined ? undefined : storedById.get(i.heldLineId);
      if (i.heldLineId !== undefined && (!s || used.has(s.id) || s.productId !== i.productId || (s.unitId ?? "") !== i.unitId)) return { refused: t.posTx.held.lineIdentity };
      if (s) used.add(s.id);
      source.push(s);
    }

    // Inactive products: a NEW held order can't use one. Re-holding a resumed order may keep its existing line unchanged.
    let kept = new Map<string, Stored[]>();
    if (previous) {
      kept = await assertKeptLines(tx, d.items, previous.items, (l, s) => l.heldLineId === s.id && sameUnit(l.unitId, s.unitId) && sameDecimal(l.quantity, s.quantity), !!previous.warehouseId && previous.warehouseId !== (d.warehouseId || null));
    } else {
      await assertProductsActive(tx, productIds);
    }

    // An order being held again may contain lines without a snapshot. Nothing is guessed for them:
    for (const i of d.items) {
      const old = previous?.items.filter((s) => s.productId === i.productId) ?? [];
      if (!old.length) continue;
      const p = byId.get(i.productId)!;
      const product = `${p.code} ${p.name}`;
      // - an inactive product's line without a snapshot can't get one (it may only be removed, or the product activated);
      if (kept.get(i.productId)?.some((s) => !hasSnapshot(s))) return { refused: tr(t, "posTx.held.legacyInactive", { product }) };
      // - a blank unit never stands in for a held line whose unit is unknown or unsnapshotted: the cashier must choose one.
      if (!i.unitId && old.some((s) => !hasSnapshot(s))) return { refused: tr(t, "posTx.held.chooseUnit", { product }) };
    }

    // A NEW hold merges duplicate lines of one unit (blank = default unit next to an explicit one, or a repeated line) with exact
    // thousandths. A resumed order refuses them instead.
    const sets = await loadUnitSets(tx, productIds);
    const current = new Map((await tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, price: true, taxType: true, orderTax: true } })).map((p) => [p.id, p]));
    const merged = new Map<string, { productId: string; unitId: string; q: bigint; source?: Stored }>();
    for (const [n, i] of d.items.entries()) {
      const p = byId.get(i.productId)!;
      const set = sets.get(i.productId);
      const s = source[n];
      // A kept (inactive) line stays in its stored unit even if that unit was switched off since.
      const keptUnit = s && kept.has(i.productId) ? s.unitId : null;
      const unitId = keptUnit ?? (set ? pickUnit(set, i.unitId, "SALE")?.unitId : undefined);
      if (!unitId) return { refused: tr(t, "units.err.notAllowed", { product: `${p.code} ${p.name}`, unit: "" }) };
      const k = `${i.productId}|${unitId}`;
      const same = merged.get(k);
      // A resumed order never combines lines: they may carry different held prices, taxes or units.
      if (same && previous) return { refused: tr(t, "posTx.held.mergeBlocked", { name: p.name, unit: set?.units.find((x) => x.unitId === unitId)?.name ?? "" }) };
      merged.set(k, { productId: i.productId, unitId, q: (same?.q ?? BigInt(0)) + toUnits(i.quantity, 3), source: s });
    }

    const rows: Row[] = [];
    for (const m of merged.values()) {
      if (m.q > toUnits("99999999999.999", 3)) return { refused: t.posTx.held.qtyLarge };
      const p = byId.get(m.productId)!;
      const label = `${p.code} ${p.name}`;
      const quantity = fromUnits(m.q, 3);
      const existing = m.source && hasSnapshot(m.source) ? m.source : undefined;
      const unit = (existing && heldUnit(existing, quantity, label)) || resolveLine(sets.get(m.productId), m.unitId, "SALE", quantity, label);
      if (!unit.ok) return { refused: tr(t, unit.f.key, unit.f.vars) };
      const u = unit.r;
      const now = current.get(m.productId)!;
      const terms = existing
        ? { unitPrice: existing.unitPrice.toFixed(2), taxType: existing.taxType!, taxRate: existing.taxRate!.toFixed(2) }
        : { unitPrice: scalePrice(now.price.toFixed(2), u.factor), taxType: now.taxType, taxRate: now.orderTax.toFixed(2) };
      // An existing line keeps its id, so the same request can safely be sent again.
      rows.push({ ...(m.source ? { id: m.source.id } : {}), productId: m.productId, productCode: p.code, productName: p.name, quantity, unitId: u.unitId, unitName: u.unitName, unitFactor: u.factor, baseQuantity: u.baseQuantity, ...terms });
    }
    return { rows };
  }
  const fields = { customerId: d.customerId || null, warehouseId: d.warehouseId || null, cashBankAccountId: null, paymentMethod: null, notes: d.notes || null };
  const tenderRows = d.tenders.map((t, position) => ({ position, paymentMethod: t.paymentMethod || null, cashBankAccountId: t.cashBankAccountId || null, amount: t.amount === "" ? null : t.amount }));

  try {
    const res = await db.$transaction(async (tx) => {
      if (d.heldOrderId) {
        // Updating the order this cart came from (no duplicate).
        await tx.$queryRaw`SELECT id FROM pos_held_orders WHERE id = ${d.heldOrderId} AND createdById = ${a.userId} FOR UPDATE`;
        const cur = await tx.posHeldOrder.findFirst({ where: { id: d.heldOrderId, createdById: a.userId }, select: { id: true, reference: true, status: true, revision: true } });
        if (!cur) return null;
        if (cur.revision !== d.heldRevision) return { conflict: true as const };
        if (cur.status !== "HELD") return null;
        const previous = await tx.posHeldOrder.findUniqueOrThrow({ where: { id: cur.id }, select: storedSelect });
        const built = await buildRows(tx, previous);
        if ("refused" in built) return built;
        // Nothing differs from what is stored: write nothing, keep the revision.
        const unchanged =
          previous.customerId === fields.customerId && previous.warehouseId === fields.warehouseId && previous.notes === fields.notes && previous.cashBankAccountId === null && previous.paymentMethod === null &&
          previous.tenders.length === tenderRows.length &&
          tenderRows.every((x, n) => x.paymentMethod === previous.tenders[n].paymentMethod && x.cashBankAccountId === previous.tenders[n].cashBankAccountId && sameDecimal(x.amount, previous.tenders[n].amount)) &&
          previous.items.length === built.rows.length &&
          built.rows.every((r) => {
            const s = previous.items.find((x) => x.id === r.id);
            return !!s && hasSnapshot(s) && s.productCode === r.productCode && s.productName === r.productName && s.unitId === r.unitId && s.unitName === r.unitName && s.taxType === r.taxType &&
              sameDecimal(r.quantity, s.quantity) && sameDecimal(r.unitPrice, s.unitPrice) && sameDecimal(r.unitFactor, s.unitFactor) && sameDecimal(r.baseQuantity, s.baseQuantity) && sameDecimal(r.taxRate, s.taxRate);
          });
        if (unchanged) return { id: cur.id, reference: cur.reference, updated: true };
        await tx.posHeldOrderItem.deleteMany({ where: { heldOrderId: cur.id } });
        await tx.posHeldOrderTender.deleteMany({ where: { heldOrderId: cur.id } });
        await tx.posHeldOrder.update({ where: { id: cur.id }, data: { ...fields, revision: { increment: 1 }, items: { create: built.rows }, tenders: { create: tenderRows } } });
        return { id: cur.id, reference: cur.reference, updated: true };
      }
      const built = await buildRows(tx, null);
      if ("refused" in built) return built;
      const open = await tx.posHeldOrder.count({ where: { createdById: a.userId, status: "HELD" } });
      if (open >= MAX_OPEN_HELD) throw new Error("LIMIT");
      const h0 = await tx.posHeldOrder.create({ data: { reference: `TMP_${randomBytes(8).toString("hex")}`, holdKey: d.holdKey, createdById: a.userId, ...fields, items: { create: built.rows }, tenders: { create: tenderRows } }, select: { id: true, number: true } });
      const reference = `HO_${String(h0.number).padStart(6, "0")}`;
      await tx.posHeldOrder.update({ where: { id: h0.id }, data: { reference } });
      return { id: h0.id, reference, updated: false };
    });
    if (!res) return { ok: false, message: t.posTx.held.notFound };
    if ("conflict" in res) return { ok: false, message: t.posTx.held.conflict, conflict: true };
    if ("refused" in res) return { ok: false, message: res.refused };
    return { ok: true, message: tr(t, res.updated ? "posTx.held.updated" : "posTx.held.held", { ref: res.reference }), id: res.id, reference: res.reference, orders: await getHeldOrders(a.userId) };
  } catch (e) {
    if (e instanceof InactiveProductError) return { ok: false, message: errorMessage(t, e) };
    if (e instanceof Error && e.message === "LIMIT") return { ok: false, message: tr(t, "posTx.held.limit", { max: MAX_OPEN_HELD }) };
    if (isKnown(e, "P2002")) {
      // The same Hold action was already saved (double click / retry) → return that order.
      const ex = await db.posHeldOrder.findUnique({ where: { holdKey: d.holdKey }, select: { id: true, reference: true, createdById: true } });
      if (ex && ex.createdById === a.userId) return { ok: true, message: tr(t, "posTx.held.held", { ref: ex.reference }), id: ex.id, reference: ex.reference, orders: await getHeldOrders(a.userId) };
      return { ok: false, message: t.posTx.held.holdKey };
    }
    throw e;
  }
}

/** Load a held order for the cart, re-validating every reference. Writes nothing and reserves no stock. */
export async function resumeHeldOrder(id: unknown): Promise<ResumeResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const t = a.t;
  const NOT_FOUND = t.posTx.held.notFound;
  const D = t;
  const hid = heldIdSchema.safeParse(id);
  if (!hid.success) return { ok: false, message: NOT_FOUND };
  // One transaction = one consistent view: the revision returned always belongs to the lines returned.
  const o = await db.$transaction((tx) => tx.posHeldOrder.findFirst({ where: { id: hid.data, createdById: a.userId, status: "HELD" }, include: { items: { orderBy: { id: "asc" } }, tenders: { orderBy: { position: "asc" } } } }));
  if (!o) return { ok: false, message: NOT_FOUND };
  if (o.warehouseId) {
    const scopeMsg = await scopeError([o.warehouseId]);
    if (scopeMsg) return { ok: false, message: scopeMsg };
  }

  // Saved tender rows; an order held BEFORE split payments has none and carries one legacy account/method: it resumes as ONE tender.
  const saved = o.tenders.length ? o.tenders.map((t) => ({ paymentMethod: t.paymentMethod ?? "", cashBankAccountId: t.cashBankAccountId ?? "", amount: t.amount ? t.amount.toFixed(2) : "" })) : o.cashBankAccountId || o.paymentMethod ? [{ paymentMethod: o.paymentMethod ?? "", cashBankAccountId: o.cashBankAccountId ?? "", amount: "" }] : [];
  const [customer, warehouse, accountRows, products, currency] = await Promise.all([
    o.customerId ? db.customer.findUnique({ where: { id: o.customerId }, select: { id: true, name: true } }) : null,
    o.warehouseId ? db.warehouse.findUnique({ where: { id: o.warehouseId }, select: { id: true } }) : null,
    saved.some((t) => t.cashBankAccountId) ? db.cashBankAccount.findMany({ where: { id: { in: saved.map((t) => t.cashBankAccountId).filter(Boolean) } }, select: { id: true, name: true, status: true, currencyId: true } }) : [],
    db.product.findMany({ where: { id: { in: o.items.map((i) => i.productId) } }, select: { id: true, active: true, price: true, taxType: true, orderTax: true } }), // an inactive product's existing line resumes, marked inactive
    getDefaultCurrency(),
  ]);
  const problems: string[] = [];
  if (o.customerId && !customer) problems.push(D.posTx.held.resumeCustomer);
  if (o.warehouseId && !warehouse) problems.push(D.posTx.held.resumeWarehouse);
  const accById = new Map(accountRows.map((a) => [a.id, a]));
  const tenders = saved.map((t) => {
    if (!t.cashBankAccountId) return t;
    const acc = accById.get(t.cashBankAccountId);
    if (!acc) problems.push(D.posTx.held.resumeAccount);
    else if (acc.status !== "ACTIVE") problems.push(tr(D, "posTx.held.resumeInactive", { name: acc.name }));
    else if (currency && acc.currencyId !== currency.id) problems.push(tr(D, "posTx.held.resumeCurrency", { name: acc.name }));
    else return t;
    return { ...t, cashBankAccountId: "" };
  });
  const live = new Set(products.map((p) => p.id));
  const inactive = new Set(products.filter((p) => !p.active).map((p) => p.id));
  const lines = o.items.map((i) => ({ productId: i.productId, code: i.productCode, name: i.productName, quantity: i.quantity.toFixed(3).replace(/\.?0+$/, ""), unitId: i.unitId ?? "", missing: !live.has(i.productId), inactive: inactive.has(i.productId), heldPrice: i.unitPrice.toFixed(2), unitName: i.unitName ?? "", unitFactor: hasSnapshot(i) ? trimFactor(i.unitFactor!.toFixed(6)) : "", needsUnit: false, id: i.id, taxType: hasSnapshot(i) ? i.taxType! : ("" as const), taxRate: hasSnapshot(i) ? i.taxRate!.toFixed(2) : "" }));
  const sets = await loadUnitSets(db, lines.filter((l) => !l.missing).map((l) => l.productId));
  const now = new Map(products.map((p) => [p.id, p]));
  const code = currency?.code ?? "";
  // Why the order can't be paid as it is (posCheckout enforces the same rules). The held price and tax are always charged: a different
  // current price or tax is reported as information only.
  const notices: { lineId: string; text: string }[] = [];
  const taxLabel = (type: "EXCLUSIVE" | "INCLUSIVE", rate: string) => `${trimFactor(rate)}% ${D.products.options[`tax${type}`]}`;
  const noteCurrent = (l: (typeof lines)[number]) => {
    const p = now.get(l.productId)!;
    const vars = { code: l.code, name: l.name, currency: code };
    const price = scalePrice(p.price.toFixed(2), l.unitFactor);
    if (price !== l.heldPrice) notices.push({ lineId: l.id, text: tr(D, "posTx.held.resumePriceChanged", { ...vars, price: l.heldPrice, now: price }) });
    if (l.taxType && (l.taxType !== p.taxType || !p.orderTax.equals(l.taxRate))) notices.push({ lineId: l.id, text: tr(D, "posTx.held.resumeTaxChanged", { ...vars, held: taxLabel(l.taxType, l.taxRate), now: taxLabel(p.taxType, p.orderTax.toFixed(2)) }) });
  };
  for (const l of lines) {
    const set = sets.get(l.productId);
    const vars = { code: l.code, name: l.name, price: l.heldPrice, currency: code };
    if (l.missing) problems.push(tr(D, "posTx.held.resumeLine", vars));
    else if (l.inactive) {
      if (!l.unitFactor) problems.push(tr(D, "posTx.held.resumeInactiveNoSnapshot", vars));
      else noteCurrent(l);
    } else {
      const unit = l.unitId && set ? pickUnit(set, l.unitId, "SALE") : null;
      if (!unit) {
        l.needsUnit = true;
        problems.push(l.unitId ? tr(D, "posTx.held.resumeUnitGone", { ...vars, unit: l.unitName || (set?.units.find((u) => u.unitId === l.unitId)?.name ?? "") }) : tr(D, "posTx.held.resumeLegacyUnit", vars));
        continue;
      }
      if (!l.unitFactor) problems.push(tr(D, "posTx.held.resumeNoSnapshot", vars));
      else noteCurrent(l);
    }
  }
  const mustRehold = o.items.some((i) => !hasSnapshot(i)) || lines.some((l) => l.needsUnit);
  return { ok: true, order: { id: o.id, revision: o.revision, reference: o.reference, customerId: customer?.id ?? "", customerName: customer?.name ?? "", warehouseId: warehouse ? (o.warehouseId ?? "") : "", tenders, notes: o.notes ?? "", lines, mustRehold, problems, notices } };
}

export async function discardHeldOrder(id: unknown, revision: unknown): Promise<DiscardResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const t = a.t;
  const NOT_FOUND = t.posTx.held.notFound;
  const hid = heldIdSchema.safeParse(id);
  if (!hid.success) return { ok: false, message: NOT_FOUND };
  // Conditional (the row is locked and rechecked by the UPDATE): only the creator's still-HELD order at the revision the user saw;
  // archived (kept for audit), never deleted.
  const rev = heldRevisionSchema.safeParse(revision);
  const r = rev.success ? await db.posHeldOrder.updateMany({ where: { id: hid.data, createdById: a.userId, status: "HELD", revision: rev.data }, data: { status: "DISCARDED", revision: { increment: 1 } } }) : { count: 0 };
  if (r.count !== 1) {
    const cur = await db.posHeldOrder.findFirst({ where: { id: hid.data, createdById: a.userId }, select: { revision: true } });
    if (cur && cur.revision !== revision) return { ok: false, message: t.posTx.held.conflict, conflict: true };
    return { ok: false, message: NOT_FOUND };
  }
  return { ok: true, message: t.posTx.held.discarded, orders: await getHeldOrders(a.userId) };
}
