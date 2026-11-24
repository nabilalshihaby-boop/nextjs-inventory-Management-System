"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { ROLE_TEMPLATES, TEMPLATE_KEYS } from "@/lib/access-templates";
import { makeRoleSchema, normalizeRoleName, type RoleField } from "@/lib/access-roles";
import { onlyKnownKeys, withRequiredPermissions } from "@/lib/access";
import { canManageRoles } from "@/lib/roles";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";

// Roles & Permissions — OWNER or ADMIN only. Every action re-reads the session (which re-reads the user from MySQL), checks that the caller
// is the OWNER, validates a STRICT payload (unknown / extra fields are rejected), derives every value from the database and writes the
// change together with its audit event in one transaction. Permission keys come only from the typed catalog; the browser can never
// supply a role id to act on behalf of another user, a permission outside the catalog, or an audit event.

export type RoleResult = { ok: true; message: string; id?: string } | { ok: false; message: string; fieldErrors?: Partial<Record<RoleField, string>> };

const idSchema = z.string().trim().min(1).max(64);
class Rejected extends Error {
  constructor(
    message: string,
    readonly field?: RoleField,
  ) {
    super(message);
  }
}
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

async function authorize(): Promise<{ t: Dictionary; actorId: string } | { error: RoleResult }> {
  const t = await getDict();
  const session = await auth();
  if (!session?.user?.id) return { error: { ok: false, message: t.common.sessionExpired } };
  if (!canManageRoles(session.user)) return { error: { ok: false, message: t.access.err.noPermission } };
  return { t, actorId: session.user.id };
}
const done = () => {
  revalidatePath("/roles");
  revalidatePath("/users");
};
const fail = (e: unknown, t: Dictionary): RoleResult => {
  if (e instanceof Rejected) return { ok: false, message: e.message, ...(e.field ? { fieldErrors: { [e.field]: e.message } } : {}) };
  if (isUnique(e)) return { ok: false, message: t.access.err.duplicate, fieldErrors: { name: t.access.err.duplicate } };
  throw e;
};

export async function createRole(input: unknown): Promise<RoleResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const { t, actorId } = a;
  const parsed = makeRoleSchema(t.access.err).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? t.access.err.invalid, fieldErrors: { [(parsed.error.issues[0]?.path[0] as RoleField) ?? "name"]: parsed.error.issues[0]?.message } };
  const d = parsed.data;
  const keys = withRequiredPermissions(onlyKnownKeys(d.permissions));
  try {
    const id = await db.$transaction(async (tx) => {
      const normalizedName = normalizeRoleName(d.name);
      if (await tx.accessRole.findUnique({ where: { normalizedName }, select: { id: true } })) throw new Rejected(t.access.err.duplicate, "name");
      const r = await tx.accessRole.create({ data: { name: d.name, normalizedName, description: d.description || null, active: d.active, permissions: { create: keys.map((permissionKey) => ({ permissionKey })) } }, select: { id: true } });
      await recordAudit(tx, { actorId, eventType: "ROLE_CREATED", targetType: "ROLE", targetId: r.id, metadata: { name: d.name, active: d.active, permissions: keys } });
      return r.id;
    });
    done();
    return { ok: true, message: t.access.ok.created, id };
  } catch (e) {
    return fail(e, t);
  }
}

export async function updateRole(id: unknown, input: unknown): Promise<RoleResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const { t, actorId } = a;
  const rid = idSchema.safeParse(id);
  if (!rid.success) return { ok: false, message: t.access.err.notFound };
  const parsed = makeRoleSchema(t.access.err).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? t.access.err.invalid, fieldErrors: { [(parsed.error.issues[0]?.path[0] as RoleField) ?? "name"]: parsed.error.issues[0]?.message } };
  const d = parsed.data;
  const keys = withRequiredPermissions(onlyKnownKeys(d.permissions));
  try {
    await db.$transaction(async (tx) => {
      const role = await tx.accessRole.findUnique({ where: { id: rid.data }, include: { permissions: { select: { permissionKey: true } } } });
      if (!role) throw new Rejected(t.access.err.notFound);
      if (role.isSystem && d.name.trim() !== role.name) throw new Rejected(t.access.err.systemName, "name");
      const normalizedName = normalizeRoleName(d.name);
      if (await tx.accessRole.findFirst({ where: { normalizedName, NOT: { id: role.id } }, select: { id: true } })) throw new Rejected(t.access.err.duplicate, "name");

      const before = new Set(role.permissions.map((p) => p.permissionKey));
      const after = new Set(keys);
      const added = keys.filter((k) => !before.has(k));
      const removed = [...before].filter((k) => !after.has(k as never));
      const detailsChanged = d.name.trim() !== role.name || (d.description || null) !== (role.description ?? null);

      await tx.accessRole.update({ where: { id: role.id }, data: { name: d.name, normalizedName, description: d.description || null, active: d.active } });
      if (removed.length) await tx.accessRolePermission.deleteMany({ where: { roleId: role.id, permissionKey: { in: removed } } });
      if (added.length) await tx.accessRolePermission.createMany({ data: added.map((permissionKey) => ({ roleId: role.id, permissionKey })) });

      if (detailsChanged) await recordAudit(tx, { actorId, eventType: "ROLE_UPDATED", targetType: "ROLE", targetId: role.id, metadata: { name: d.name, previousName: role.name } });
      if (added.length || removed.length) await recordAudit(tx, { actorId, eventType: "ROLE_PERMISSIONS_CHANGED", targetType: "ROLE", targetId: role.id, metadata: { added, removed } });
      if (d.active !== role.active) await recordAudit(tx, { actorId, eventType: d.active ? "ROLE_ACTIVATED" : "ROLE_DEACTIVATED", targetType: "ROLE", targetId: role.id, metadata: { name: d.name } });
    });
    done();
    return { ok: true, message: t.access.ok.updated };
  } catch (e) {
    return fail(e, t);
  }
}

/** Activate / deactivate from the list. An inactive role grants nothing: its users are blocked on their next request. */
export async function setRoleActive(id: unknown, active: unknown): Promise<RoleResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const { t, actorId } = a;
  const rid = idSchema.safeParse(id);
  if (!rid.success || typeof active !== "boolean") return { ok: false, message: t.access.err.invalid };
  try {
    await db.$transaction(async (tx) => {
      const role = await tx.accessRole.findUnique({ where: { id: rid.data }, select: { id: true, name: true, active: true } });
      if (!role) throw new Rejected(t.access.err.notFound);
      if (role.active === active) return;
      await tx.accessRole.update({ where: { id: role.id }, data: { active } });
      await recordAudit(tx, { actorId, eventType: active ? "ROLE_ACTIVATED" : "ROLE_DEACTIVATED", targetType: "ROLE", targetId: role.id, metadata: { name: role.name } });
    });
    done();
    return { ok: true, message: active ? t.access.ok.activated : t.access.ok.deactivated };
  } catch (e) {
    return fail(e, t);
  }
}

export async function cloneRole(id: unknown, name: unknown): Promise<RoleResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const { t, actorId } = a;
  const rid = idSchema.safeParse(id);
  const nm = z.string().trim().min(1, t.access.err.nameRequired).max(80, t.access.err.nameLong).safeParse(name);
  if (!rid.success) return { ok: false, message: t.access.err.notFound };
  if (!nm.success) return { ok: false, message: nm.error.issues[0].message, fieldErrors: { name: nm.error.issues[0].message } };
  try {
    const newId = await db.$transaction(async (tx) => {
      const src = await tx.accessRole.findUnique({ where: { id: rid.data }, include: { permissions: { select: { permissionKey: true } } } });
      if (!src) throw new Rejected(t.access.err.notFound);
      const normalizedName = normalizeRoleName(nm.data);
      if (await tx.accessRole.findUnique({ where: { normalizedName }, select: { id: true } })) throw new Rejected(t.access.err.duplicate, "name");
      const keys = onlyKnownKeys(src.permissions.map((p) => p.permissionKey));
      const r = await tx.accessRole.create({ data: { name: nm.data, normalizedName, description: src.description, active: true, isSystem: false, permissions: { create: keys.map((permissionKey) => ({ permissionKey })) } }, select: { id: true } });
      await recordAudit(tx, { actorId, eventType: "ROLE_CLONED", targetType: "ROLE", targetId: r.id, metadata: { name: nm.data, clonedFrom: src.id, clonedFromName: src.name, permissions: keys } });
      return r.id;
    });
    done();
    return { ok: true, message: t.access.ok.cloned, id: newId };
  } catch (e) {
    return fail(e, t);
  }
}

/** A system template, or a role assigned to anyone, can never be deleted (the database also refuses: Restrict on User.accessRoleId). */
export async function deleteRole(id: unknown): Promise<RoleResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const { t, actorId } = a;
  const rid = idSchema.safeParse(id);
  if (!rid.success) return { ok: false, message: t.access.err.notFound };
  try {
    await db.$transaction(async (tx) => {
      const role = await tx.accessRole.findUnique({ where: { id: rid.data }, select: { id: true, name: true, isSystem: true, _count: { select: { users: true } } } });
      if (!role) throw new Rejected(t.access.err.notFound);
      if (role.isSystem) throw new Rejected(t.access.err.systemDelete);
      if (role._count.users > 0) throw new Rejected(fmt(t.access.err.inUse, { n: role._count.users }));
      await tx.accessRole.delete({ where: { id: role.id } });
      await recordAudit(tx, { actorId, eventType: "ROLE_DELETED", targetType: "ROLE", targetId: role.id, metadata: { name: role.name } });
    });
    done();
    return { ok: true, message: t.access.ok.deleted };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") return { ok: false, message: t.access.err.inUse.replace("{n}", "") };
    return fail(e, t);
  }
}

/** Explicit, idempotent: creates only the missing system templates, never touches an existing role, creates no users. */
export async function initializeDefaultRoles(): Promise<RoleResult> {
  const a = await authorize();
  if ("error" in a) return a.error;
  const { t, actorId } = a;
  try {
    const created = await db.$transaction(async (tx) => {
      const made: string[] = [];
      for (const key of TEMPLATE_KEYS) {
        if (await tx.accessRole.findUnique({ where: { templateKey: key }, select: { id: true } })) continue;
        const tpl = ROLE_TEMPLATES[key];
        // A custom role may already use the template's name: the template then gets a distinguishable name instead of failing.
        let name = tpl.name;
        if (await tx.accessRole.findUnique({ where: { normalizedName: normalizeRoleName(name) }, select: { id: true } })) name = `${tpl.name} (template)`;
        const r = await tx.accessRole.create({
          data: { name, normalizedName: normalizeRoleName(name), description: tpl.description, active: true, isSystem: true, templateKey: key, permissions: { create: tpl.permissions.map((permissionKey) => ({ permissionKey })) } },
          select: { id: true },
        });
        made.push(key);
        await recordAudit(tx, { actorId, eventType: "ROLE_CREATED", targetType: "ROLE", targetId: r.id, metadata: { name, template: key, permissions: tpl.permissions } });
      }
      if (made.length) await recordAudit(tx, { actorId, eventType: "TEMPLATES_INITIALIZED", targetType: "SYSTEM", targetId: "access-roles", metadata: { created: made } });
      return made.length;
    });
    done();
    return { ok: true, message: created ? fmt(t.access.ok.initialized, { n: created }) : t.access.ok.initializedNone };
  } catch (e) {
    return fail(e, t);
  }
}
