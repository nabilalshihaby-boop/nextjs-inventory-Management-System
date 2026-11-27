import { db } from "@/lib/db";
import { effectivePermissions, onlyKnownKeys } from "@/lib/access";

// Server-only: resolves what a user may do from the DATABASE, on every request (nothing here is cached across requests, so a role
// change, deactivation or scope change takes effect on the user's very next request).

export type ResolvedAccess = {
  /** The permissions of the assigned, ACTIVE operational role (USER only; OWNER/ADMIN are handled by role in lib/access.ts). */
  permissions: string[];
  /** USER: the assigned warehouses (possibly none). OWNER / ADMIN: null = unrestricted. */
  warehouseIds: string[] | null;
  accessRole: { id: string; name: string } | null;
  /** True when no warehouse is outside the assignment (always true for OWNER / ADMIN). Company-wide actions need it. */
  coversAllWarehouses: boolean;
};

export async function loadAccess(userId: string): Promise<ResolvedAccess> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      accessRole: { select: { id: true, name: true, active: true, permissions: { select: { permissionKey: true } } } },
      warehouseScopes: { select: { warehouseId: true } },
    },
  });
  if (!u) return { permissions: [], warehouseIds: [], accessRole: null, coversAllWarehouses: false };
  if (u.role !== "USER") return { permissions: [], warehouseIds: null, accessRole: null, coversAllWarehouses: true };
  // An INACTIVE role grants nothing: the user is blocked from operational routes on their next request.
  const active = u.accessRole?.active ? u.accessRole : null;
  const warehouseIds = u.warehouseScopes.map((w) => w.warehouseId);
  return {
    permissions: active ? effectivePermissions(onlyKnownKeys(active.permissions.map((p) => p.permissionKey))) : [],
    warehouseIds,
    coversAllWarehouses: (await db.warehouse.count({ where: { id: { notIn: warehouseIds } } })) === 0,
    accessRole: u.accessRole ? { id: u.accessRole.id, name: u.accessRole.name } : null,
  };
}
