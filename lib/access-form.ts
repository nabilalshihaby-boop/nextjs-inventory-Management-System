import { db } from "@/lib/db";
import { needsWarehouseScope, onlyKnownKeys } from "@/lib/access";
import { displayRoleName } from "@/lib/access-roles";
import { getDict } from "@/lib/i18n/server";

// Options for the operational-role and warehouse pickers of the Owner's User create / edit screens (server-only; Owner pages only).
export type AccessRoleOption = { id: string; label: string; active: boolean; needsScope: boolean };
export type AccessFormData = { accessRoles: AccessRoleOption[]; warehouses: { id: string; name: string }[] };

export async function getAccessFormData(): Promise<AccessFormData> {
  const t = await getDict();
  const [roles, warehouses] = await Promise.all([
    db.accessRole.findMany({ orderBy: [{ isSystem: "desc" }, { name: "asc" }], include: { permissions: { select: { permissionKey: true } } } }),
    db.warehouse.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return {
    accessRoles: roles.map((r) => ({ id: r.id, label: displayRoleName(t, r), active: r.active, needsScope: needsWarehouseScope(onlyKnownKeys(r.permissions.map((p) => p.permissionKey))) })),
    warehouses,
  };
}
