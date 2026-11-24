import { canManageSystemSettings } from "@/lib/roles";
import type { Who } from "@/lib/access";

// System Settings "Default Warehouse" (server-side data path). Only OWNER / ADMIN may manage System Settings (canManageSystemSettings), and
// the option list is deliberately NOT filtered by UserWarehouseScope: that scope narrows what a USER with an operational role may work
// with; it never applies to the people who administer the organization. A USER is refused outright.
//
// Warehouses have no active/inactive flag (they are hard-deleted, and the FK on system_settings is ON DELETE RESTRICT), so "eligible" =
// "exists". A saved default that no longer resolves to a warehouse is reported (state "missing"), never silently replaced.

export type WarehouseOption = { value: string; label: string };

/** The slice of the Prisma client this module needs (lets tests inject an in-memory fake). */
export type WarehouseReader = {
  warehouse: {
    findMany(args: { orderBy: { name: "asc" }; select: { id: true; name: true } }): Promise<{ id: string; name: string }[]>;
    findUnique(args: { where: { id: string }; select: { id: true } }): Promise<{ id: string } | null>;
  };
};

export type DefaultWarehouseState =
  /** Nothing saved yet (optional field). */
  | { status: "none" }
  | { status: "ok" }
  /** A default id is saved but no such warehouse exists any more — the Owner must choose a new one. */
  | { status: "missing"; savedId: string };

export class SettingsAccessError extends Error {
  constructor() {
    super("System Settings: OWNER or ADMIN only");
  }
}

/** All warehouses for the Default Warehouse select. Throws for anyone who may not open System Settings. */
export async function getDefaultWarehouseOptions(who: Who, client: WarehouseReader): Promise<WarehouseOption[]> {
  if (!canManageSystemSettings(who)) throw new SettingsAccessError();
  const rows = await client.warehouse.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  return rows.map((w) => ({ value: w.id, label: w.name }));
}

export function defaultWarehouseState(savedId: string | null | undefined, options: readonly WarehouseOption[]): DefaultWarehouseState {
  if (!savedId) return { status: "none" };
  return options.some((o) => o.value === savedId) ? { status: "ok" } : { status: "missing", savedId };
}

export type DefaultWarehouseCheck = { ok: true; id: string | null } | { ok: false; reason: "forbidden" | "unknown" };

/** Validates the submitted id: "" clears it; anything else must be the id of a real warehouse (forged / stale ids are rejected). */
export async function validateDefaultWarehouseId(who: Who, submitted: string, client: WarehouseReader): Promise<DefaultWarehouseCheck> {
  if (!canManageSystemSettings(who)) return { ok: false, reason: "forbidden" };
  const id = submitted.trim();
  if (id === "") return { ok: true, id: null };
  if (id.length > 64) return { ok: false, reason: "unknown" };
  const found = await client.warehouse.findUnique({ where: { id }, select: { id: true } });
  return found ? { ok: true, id: found.id } : { ok: false, reason: "unknown" };
}
