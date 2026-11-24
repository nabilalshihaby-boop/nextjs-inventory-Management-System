import { cache } from "react";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { allInWarehouseScope, warehouseScopeOf, type WarehouseScope } from "@/lib/access";
import { getDict } from "@/lib/i18n/server";

// Warehouse-scope enforcement (server-only). A USER with an operational role is limited to the warehouses the Owner assigned; OWNER and ADMIN
// are unrestricted. The scope is read from the signed-in session on every request (which re-reads MySQL), never from the browser. These
// helpers are used by every loader, page and Server Action that touches warehouse-bound data, so a forged id in a direct request is
// refused exactly like a missing dropdown option.

const sessionUser = cache(async () => (await auth())?.user ?? null);

/** The current user's warehouse scope: null = unrestricted. A missing session has no access (empty scope). */
export async function currentScope(): Promise<WarehouseScope> {
  return warehouseScopeOf(await sessionUser());
}

/** Prisma `where` for the Warehouse model itself. */
export async function warehouseFilter(): Promise<{ id?: { in: string[] } }> {
  const s = await currentScope();
  return s === null ? {} : { id: { in: [...s] } };
}
/** Prisma `where` fragment for any model with a `warehouseId` column. */
export async function warehouseIdFilter(): Promise<{ warehouseId?: { in: string[] } }> {
  const s = await currentScope();
  return s === null ? {} : { warehouseId: { in: [...s] } };
}

export async function inScope(ids: readonly (string | null | undefined)[]): Promise<boolean> {
  return allInWarehouseScope(await sessionUser(), ids);
}

/** Localized refusal when any of the warehouses is outside the user's scope, else null. */
export async function scopeError(ids: readonly (string | null | undefined)[]): Promise<string | null> {
  if (await inScope(ids)) return null;
  return (await getDict()).access.scope.denied;
}

export type RecordKind = "sale" | "saleReturn" | "purchase" | "purchaseReturn" | "quotation" | "adjustment" | "transfer" | "expense";

/** The warehouse(s) a stored document belongs to (null = the document does not exist). A transfer needs both its warehouses. */
async function warehousesOf(kind: RecordKind, id: string): Promise<string[] | null> {
  const w = { select: { warehouseId: true } } as const;
  switch (kind) {
    case "sale": { const r = await db.sale.findUnique({ where: { id }, ...w }); return r ? [r.warehouseId] : null; }
    case "saleReturn": { const r = await db.saleReturn.findUnique({ where: { id }, ...w }); return r ? [r.warehouseId] : null; }
    case "purchase": { const r = await db.purchase.findUnique({ where: { id }, ...w }); return r ? [r.warehouseId] : null; }
    case "purchaseReturn": { const r = await db.purchaseReturn.findUnique({ where: { id }, ...w }); return r ? [r.warehouseId] : null; }
    case "quotation": { const r = await db.quotation.findUnique({ where: { id }, ...w }); return r ? [r.warehouseId] : null; }
    case "adjustment": { const r = await db.stockAdjustment.findUnique({ where: { id }, ...w }); return r ? [r.warehouseId] : null; }
    case "expense": { const r = await db.expense.findUnique({ where: { id }, ...w }); return r ? [r.warehouseId] : null; }
    case "transfer": { const r = await db.stockTransfer.findUnique({ where: { id }, select: { fromWarehouseId: true, toWarehouseId: true } }); return r ? [r.fromWarehouseId, r.toWarehouseId] : null; }
  }
}

/** True when the document exists but lies outside the user's scope (a missing document is left to the caller's own "not found"). */
export async function recordOutOfScope(kind: RecordKind, id: string): Promise<boolean> {
  if ((await currentScope()) === null) return false;
  const ws = await warehousesOf(kind, id);
  return ws !== null && !(await inScope(ws));
}
export async function recordScopeError(kind: RecordKind, id: string): Promise<string | null> {
  return (await recordOutOfScope(kind, id)) ? (await getDict()).access.scope.denied : null;
}

/** Prisma `where` for transfers: both the source and the destination warehouse must be inside the scope. */
export async function transferFilter(): Promise<{ fromWarehouseId?: { in: string[] }; toWarehouseId?: { in: string[] } }> {
  const s = await currentScope();
  return s === null ? {} : { fromWarehouseId: { in: [...s] }, toWarehouseId: { in: [...s] } };
}
