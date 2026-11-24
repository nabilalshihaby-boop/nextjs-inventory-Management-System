import { z } from "zod";
import { db } from "@/lib/db";
import { isPermissionKey, PERMISSION_KEYS } from "@/lib/access";
import { TEMPLATE_KEYS, type TemplateKey } from "@/lib/access-templates";
import type { Dictionary } from "@/lib/i18n";

// Roles & Permissions — shared types, validation and read access (server-side; the page and the actions both call these).

export type RoleRow = {
  id: string;
  name: string;
  /** System templates are shown in the user's language; custom roles keep the Owner's own name. */
  displayName: string;
  description: string;
  active: boolean;
  isSystem: boolean;
  templateKey: string | null;
  staffCount: number;
  permissions: string[];
};
export type RoleField = "name" | "description" | "permissions" | "active";

export const normalizeRoleName = (name: string) => name.trim().toLowerCase();

/** Strict payload: unknown or extra fields (a forged id, role flag, user list …) are rejected outright. */
export function makeRoleSchema(m: Dictionary["access"]["err"]) {
  return z.strictObject({
    name: z.string({ error: m.nameRequired }).trim().min(1, m.nameRequired).max(80, m.nameLong),
    description: z.string().trim().max(255, m.descLong).optional().default(""),
    active: z.boolean({ error: m.invalid }),
    permissions: z
      .array(z.string(), { error: m.permRequired })
      .min(1, m.permRequired)
      .max(PERMISSION_KEYS.length, m.invalid)
      .refine((a) => a.every(isPermissionKey), m.invalid),
  });
}
export type RoleInput = z.infer<ReturnType<typeof makeRoleSchema>>;

export const displayRoleName = (t: Dictionary, r: { name: string; templateKey: string | null }) => {
  const tpl = r.templateKey && (TEMPLATE_KEYS as readonly string[]).includes(r.templateKey) ? t.access.templates[r.templateKey as TemplateKey] : null;
  return tpl?.name ?? r.name;
};

export async function listRoles(t: Dictionary): Promise<RoleRow[]> {
  const roles = await db.accessRole.findMany({ orderBy: [{ isSystem: "desc" }, { name: "asc" }], include: { permissions: { select: { permissionKey: true } }, _count: { select: { users: true } } } });
  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    displayName: displayRoleName(t, r),
    description: r.description ?? "",
    active: r.active,
    isSystem: r.isSystem,
    templateKey: r.templateKey,
    staffCount: r._count.users,
    permissions: r.permissions.map((p) => p.permissionKey).filter(isPermissionKey),
  }));
}

export async function getRole(id: string, t: Dictionary): Promise<RoleRow | null> {
  const r = await db.accessRole.findUnique({ where: { id }, include: { permissions: { select: { permissionKey: true } }, _count: { select: { users: true } } } });
  if (!r) return null;
  return { id: r.id, name: r.name, displayName: displayRoleName(t, r), description: r.description ?? "", active: r.active, isSystem: r.isSystem, templateKey: r.templateKey, staffCount: r._count.users, permissions: r.permissions.map((p) => p.permissionKey).filter(isPermissionKey) };
}

export type AuditRow = { id: string; at: string; eventType: string; actor: string; metadata: Record<string, unknown> | null };

/** Audit events about one role (read-only). */
export async function getRoleAudit(roleId: string, dateTime: (d: Date) => string): Promise<AuditRow[]> {
  // Events about the role itself, plus user-role assignments that mention it (as the new or the previous role).
  const events = await db.auditEvent.findMany({
    where: { OR: [{ targetType: "ROLE", targetId: roleId }, { targetType: "USER", metadata: { path: "$.roleId", equals: roleId } }, { targetType: "USER", metadata: { path: "$.previousRoleId", equals: roleId } }] },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const actors = new Map((await db.user.findMany({ where: { id: { in: [...new Set(events.map((e) => e.actorId))] } }, select: { id: true, firstName: true, lastName: true } })).map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  return events.map((e) => ({ id: e.id, at: dateTime(e.createdAt), eventType: e.eventType, actor: actors.get(e.actorId) ?? "—", metadata: (e.metadata as Record<string, unknown> | null) ?? null }));
}
