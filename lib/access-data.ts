import { db } from "@/lib/db";
import { onlyKnownKeys, type PermissionKey } from "@/lib/access";

// Server-only: resolves a user's operational access from MySQL. Called on EVERY session read (auth.ts), so a deactivated role,
// a removed permission or a changed warehouse scope takes effect on the user's very next request. Nothing here comes from the client.

export type ResolvedAccess = {
  /** Permissions of the assigned ACTIVE role (empty for OWNER/ADMIN, who are not governed by roles, and for an unassigned or inactive-role USER). */
  permissions: PermissionKey[];
  /** Assigned warehouses for a USER; null (unrestricted) for OWNER / ADMIN. */
  warehouseIds: string[] | null;
  accessRole: { id: string; name: string } | null;
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
  if (!u) return { permissions: [], warehouseIds: [], accessRole: null };
  if (u.role !== "USER") return { permissions: [], warehouseIds: null, accessRole: null };
  const role = u.accessRole && u.accessRole.active ? u.accessRole : null;
  return {
    permissions: role ? onlyKnownKeys(role.permissions.map((p) => p.permissionKey)) : [],
    warehouseIds: u.warehouseScopes.map((w) => w.warehouseId).sort(),
    accessRole: role ? { id: role.id, name: role.name } : null,
  };
}
