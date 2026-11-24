import type { Prisma } from "@/app/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { needsWarehouseScope, onlyKnownKeys } from "@/lib/access";
import type { Dictionary } from "@/lib/i18n";

// Assigning an operational role and warehouse scope to a user (server-only). Runs INSIDE the transaction of the user create / update that
// asked for it, validates against the database (the browser only sends ids), and records every change in the audit trail.
//   - Only a platform USER carries an operational role; ADMIN / OWNER are never limited by one (any previous assignment is cleared).
//   - Only an ACTIVE role can be newly assigned (an existing assignment to a since-deactivated role may stay until the Owner changes it).
//   - Warehouses are stored only when the role includes warehouse-scoped permissions; otherwise the scope is cleared.

export class AccessRejected extends Error {}

export type AccessInput = { role: "ADMIN" | "USER"; accessRoleId: string; warehouseIds: string[] };

export async function applyUserAccess(tx: Prisma.TransactionClient, a: { actorId: string; userId: string; userName: string; input: AccessInput; t: Dictionary }): Promise<void> {
  const { t } = a;
  const cur = await tx.user.findUnique({ where: { id: a.userId }, select: { accessRoleId: true, accessRole: { select: { name: true } }, warehouseScopes: { select: { warehouseId: true } } } });
  const currentRoleId = cur?.accessRoleId ?? null;
  const currentScope = (cur?.warehouseScopes ?? []).map((w) => w.warehouseId).sort();

  let newRoleId: string | null = null;
  let newRoleName: string | null = null;
  let newScope: string[] = [];
  if (a.input.role === "USER" && a.input.accessRoleId) {
    const role = await tx.accessRole.findUnique({ where: { id: a.input.accessRoleId }, select: { id: true, name: true, active: true, permissions: { select: { permissionKey: true } } } });
    if (!role) throw new AccessRejected(t.access.err.roleUnknown);
    if (!role.active && role.id !== currentRoleId) throw new AccessRejected(t.access.err.roleInactive);
    newRoleId = role.id;
    newRoleName = role.name;
    if (needsWarehouseScope(onlyKnownKeys(role.permissions.map((p) => p.permissionKey)))) {
      const ids = [...new Set(a.input.warehouseIds)];
      if (ids.length) {
        const found = await tx.warehouse.count({ where: { id: { in: ids } } });
        if (found !== ids.length) throw new AccessRejected(t.access.err.warehouseUnknown);
      }
      newScope = ids.sort();
    }
  }

  if (currentRoleId !== newRoleId) {
    await tx.user.update({ where: { id: a.userId }, data: { accessRoleId: newRoleId } });
    await recordAudit(tx, {
      actorId: a.actorId,
      eventType: currentRoleId === null ? "USER_ROLE_ASSIGNED" : newRoleId === null ? "USER_ROLE_UNASSIGNED" : "USER_ROLE_CHANGED",
      targetType: "USER",
      targetId: a.userId,
      metadata: { userName: a.userName, roleId: newRoleId, roleName: newRoleName, previousRoleId: currentRoleId, previousRoleName: cur?.accessRole?.name ?? null },
    });
  }
  if (currentScope.join() !== newScope.join()) {
    await tx.userWarehouseScope.deleteMany({ where: { userId: a.userId } });
    if (newScope.length) await tx.userWarehouseScope.createMany({ data: newScope.map((warehouseId) => ({ userId: a.userId, warehouseId })) });
    await recordAudit(tx, { actorId: a.actorId, eventType: "USER_WAREHOUSE_SCOPE_CHANGED", targetType: "USER", targetId: a.userId, metadata: { userName: a.userName, roleId: newRoleId, before: currentScope, after: newScope } });
  }
}
