"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { coversEveryWarehouse } from "@/lib/access-scope";
import { fmt } from "@/lib/i18n/config";
import { getDict } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n";
import { canManageProducts } from "@/lib/roles";
import { MAX_REMOVE, previewRemoval, removeProducts, setProductsActive } from "@/lib/product-removal";
import type { Reason } from "@/lib/product-removal-core";

// Product removal and status (OWNER/ADMIN and users with products.manage). The SERVER decides the outcome of a removal:
// a product with no stock and no history is deleted, any other is deactivated (lib/product-removal.ts). These actions only validate the
// request, check permissions and call that one implementation. A malformed, duplicated, unknown, forged or oversized id list is refused as a
// whole with no write. Removing/deactivating is company-wide, so a USER who isn't assigned to every warehouse is refused (it would affect
// warehouses they have no access to).

export type RemovalItem = { id: string; code: string; name: string; outcome: "DELETE" | "DEACTIVATE" | "KEEP_INACTIVE"; reasons: Reason[] };
export type PreviewResult = { ok: true; items: RemovalItem[]; deleteCount: number; deactivateCount: number; keepCount: number } | { ok: false; message: string };
export type RemoveResult = { ok: true; message: string; deleted: number; deactivated: number; unchanged: number } | { ok: false; message: string };
export type StatusActionResult = { ok: true; message: string; changed: number } | { ok: false; message: string };

const CONTROL = /[\u0000-\u001f\u007f]/;

async function authorize(t: Dictionary): Promise<{ userId: string } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: t.common.sessionExpired };
  if (!canManageProducts(session.user)) return { error: t.products.status.err.noPermission };
  if (!(await coversEveryWarehouse())) return { error: t.products.status.err.scope };
  return { userId: session.user.id };
}

/** A strict list of distinct product ids (1…MAX_REMOVE strings, no blanks or control characters). null when anything is off. */
function idList(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_REMOVE) return null;
  const out: string[] = [];
  for (const v of input) {
    if (typeof v !== "string") return null;
    const id = v.trim();
    if (!id || id !== v || id.length > 64 || CONTROL.test(id)) return null;
    out.push(id);
  }
  return new Set(out).size === out.length ? out : null;
}

function tooMany(input: unknown): boolean {
  return Array.isArray(input) && input.length > MAX_REMOVE;
}

/** What each selected product would become, decided now (read-only). The confirmation dialog shows exactly this. */
export async function previewProductRemoval(input: unknown): Promise<PreviewResult> {
  const t = await getDict();
  const S = t.products.status;
  const a = await authorize(t);
  if ("error" in a) return { ok: false, message: a.error };
  const ids = idList(input);
  if (!ids) return { ok: false, message: tooMany(input) ? fmt(S.err.tooMany, { max: MAX_REMOVE }) : S.err.invalidRequest };
  const rows = await previewRemoval(ids);
  if (rows.length !== ids.length) return { ok: false, message: S.err.missing };
  const order = new Map(ids.map((id, i) => [id, i]));
  const items = rows.sort((x, y) => order.get(x.id)! - order.get(y.id)!).map((r) => ({ id: r.id, code: r.code, name: r.name, outcome: r.outcome, reasons: r.reasons }));
  return { ok: true, items, deleteCount: items.filter((i) => i.outcome === "DELETE").length, deactivateCount: items.filter((i) => i.outcome === "DEACTIVATE").length, keepCount: items.filter((i) => i.outcome === "KEEP_INACTIVE").length };
}

/**
 * Remove: permanently deletes the products with no stock/history and deactivates the rest, in ONE transaction. `deleteIds` is the list the
 * user confirmed as "will be permanently deleted"; a product that is eligible at execution time but was not on that list is deactivated
 * instead (nothing is ever deleted that the user wasn't told about).
 */
export async function removeProductsAction(input: unknown, deleteIds: unknown): Promise<RemoveResult> {
  const t = await getDict();
  const S = t.products.status;
  const a = await authorize(t);
  if ("error" in a) return { ok: false, message: a.error };
  const ids = idList(input);
  if (!ids) return { ok: false, message: tooMany(input) ? fmt(S.err.tooMany, { max: MAX_REMOVE }) : S.err.invalidRequest };
  let allow: string[] = [];
  if (!(Array.isArray(deleteIds) && deleteIds.length === 0)) {
    const list = idList(deleteIds);
    if (!list) return { ok: false, message: S.err.invalidRequest };
    allow = list;
  }
  if (allow.some((id) => !ids.includes(id))) return { ok: false, message: S.err.invalidRequest };
  try {
    const r = await removeProducts(a.userId, ids, new Set(allow));
    if (!r.ok) return { ok: false, message: S.err.missing };
    revalidatePath("/products");
    revalidatePath("/audit-log");
    return { ok: true, message: fmt(S.doneRemoved, { deleted: r.deleted.length, deactivated: r.deactivated.length, unchanged: r.kept.length }), deleted: r.deleted.length, deactivated: r.deactivated.length, unchanged: r.kept.length };
  } catch {
    return { ok: false, message: S.err.failed }; // the transaction rolled back: nothing changed
  }
}

/** Activate or deactivate products (a pure status change; history is untouched). */
export async function setProductsStatus(input: unknown, active: unknown): Promise<StatusActionResult> {
  const t = await getDict();
  const S = t.products.status;
  const a = await authorize(t);
  if ("error" in a) return { ok: false, message: a.error };
  const ids = idList(input);
  if (!ids || typeof active !== "boolean") return { ok: false, message: ids === null && tooMany(input) ? fmt(S.err.tooMany, { max: MAX_REMOVE }) : S.err.invalidRequest };
  try {
    const r = await setProductsActive(a.userId, ids, active);
    if (!r.ok) return { ok: false, message: S.err.missing };
    revalidatePath("/products");
    revalidatePath("/audit-log");
    if (r.changed.length === 0) return { ok: true, message: S.noChange, changed: 0 };
    return { ok: true, message: fmt(active ? S.doneActivated : S.doneDeactivated, { n: r.changed.length }), changed: r.changed.length };
  } catch {
    return { ok: false, message: S.err.failed };
  }
}
