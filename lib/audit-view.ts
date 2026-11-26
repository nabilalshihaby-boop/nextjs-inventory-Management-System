import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { AUDIT_EVENT_TYPES } from "@/lib/audit";
import { fmt, type Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";
import { CATEGORY_OF, localDay, safeDetails, targetLabel, typesOfCategory, type AuditQuery, type AuditQueryIssue, type SafeDetail } from "@/lib/audit-core";

// Audit Log viewer — the ONLY reads of audit_events for the /audit-log page (server-only). It never writes: the Prisma calls here are
// count / findMany / groupBy and nothing else, and no function in this file or the page can update or delete an event.
// What leaves this module is a plain, already-safe row (see lib/audit-core.ts safeDetails): never the raw metadata JSON.

/** A name or value inserted into a sentence, isolated so right-to-left and left-to-right text never reorder around it. */
const iso = (s: string) => `⁨${s}⁩`;

export type AuditRowView = {
  id: string;
  at: string;
  actor: string;
  actorDeleted: boolean;
  eventType: string;
  eventLabel: string;
  category: string | null;
  targetType: string;
  targetTypeLabel: string;
  target: string | null;
  reference: string;
  summary: string;
  details: { label: string; value: string }[];
};
export type ActorOption = { id: string; name: string; deleted: boolean };
export type AuditPage = {
  rows: AuditRowView[];
  total: number;
  page: number;
  last: number;
  from: number;
  to: number;
  /** Whether the log holds any event at all (to tell "nothing recorded yet" from "nothing matches"). */
  anyEvents: boolean;
  actors: ActorOption[];
};

const userName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();

/** Every actor that appears in the log, with the current user name or a "Deleted user" fallback. */
export async function loadActors(t: Dictionary): Promise<ActorOption[]> {
  const ids = (await db.auditEvent.groupBy({ by: ["actorId"] })).map((g) => g.actorId);
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } });
  const byId = new Map(users.map((u) => [u.id, userName(u)]));
  return ids
    .map((id) => ({ id, name: byId.get(id) || t.auditLog.deletedUser, deleted: !byId.has(id) }))
    .sort((a, b) => Number(a.deleted) - Number(b.deleted) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The event type's friendly label in the active language (falls back to the raw code for a type this build does not know). */
export const eventLabel = (t: Dictionary, type: string) => (t.access.audit.events as Record<string, string>)[type] ?? type;

function summaryOf(t: Dictionary, type: string, target: string | null, details: SafeDetail[]): string {
  const S = t.auditLog.summary;
  const known = (S as Record<string, string>)[type];
  if (!known || !(AUDIT_EVENT_TYPES as readonly string[]).includes(type)) return S.unknownEvent;
  const text = (id: string) => {
    const d = details.find((x) => x.id === id);
    return d && d.kind === "text" ? iso(d.value) : S.unknownTarget;
  };
  const num = (id: string) => {
    const d = details.find((x) => x.id === id);
    return d && d.kind === "number" ? d.value : 0;
  };
  const list = (id: string) => {
    const d = details.find((x) => x.id === id);
    return d && (d.kind === "permissions" || d.kind === "templates") ? d.value.length : 0;
  };
  return fmt(known, {
    target: target ? iso(target) : S.unknownTarget,
    from: type === "ROLE_CLONED" ? text("clonedFromName") : type === "USER_WAREHOUSE_SCOPE_CHANGED" ? num("warehousesBefore") : text("previousRoleName"),
    to: num("warehousesAfter"),
    role: text("roleName"),
    added: list("added"),
    removed: list("removed"),
    n: list("created"),
    requested: num("requested"),
    deleted: num("deleted"),
    deactivated: num("deactivated"),
    changed: num("changed"),
    unchanged: num("unchanged"),
  });
}

/** A detail's value, formatted for the active language. */
function detailValue(t: Dictionary, d: SafeDetail): string {
  const D = t.auditLog.details;
  switch (d.kind) {
    case "text":
      return d.value;
    case "locale":
      return d.value === "ar" ? D.ar : D.en;
    case "bool":
      return d.value ? D.yes : D.no;
    case "reasons":
      return d.value.map((k) => (t.auditLog.reasons as Record<string, string>)[k] ?? k).join(" · ");
    case "number":
      if (d.id === "requested" || d.id === "deleted" || d.id === "deactivated" || d.id === "unchanged" || d.id === "changed") return String(d.value);
      return d.id === "previousLength" || d.id === "newLength" ? fmt(D.chars, { n: d.value }) : d.id === "permissionCount" ? fmt(D.permissionsCount, { n: d.value }) : fmt(D.warehousesCount, { n: d.value });
    case "permissions":
      return d.value.map((k) => (t.access.perm as Record<string, string>)[k.replace(/\./g, "_")] ?? k).join(" · ");
    case "templates":
      return d.value.map((k) => (t.access.templates as Record<string, { name: string }>)[k]?.name ?? k).join(" · ");
  }
}

type Row = { id: string; actorId: string; eventType: string; targetType: string; targetId: string; metadata: Prisma.JsonValue; createdAt: Date };

export function toView(t: Dictionary, r: Row, actors: Map<string, ActorOption>, dateFormat: string | null | undefined, locale: Locale): AuditRowView {
  const a = actors.get(r.actorId);
  const details = safeDetails(r.eventType, r.metadata);
  let target = targetLabel(r.targetType, r.targetId, r.metadata);
  if (!target && r.targetType === "SYSTEM") target = (t.auditLog.systemRefs as Record<string, string>)[r.targetId] ?? null;
  const category = (CATEGORY_OF as Record<string, string | undefined>)[r.eventType] ?? null;
  return {
    id: r.id,
    at: formatDateTime(r.createdAt, dateFormat, locale),
    actor: a && !a.deleted ? a.name : t.auditLog.deletedUser,
    actorDeleted: !a || a.deleted,
    eventType: r.eventType,
    eventLabel: eventLabel(t, r.eventType),
    category: category ? (t.auditLog.categories as Record<string, string>)[category] : null,
    targetType: r.targetType,
    targetTypeLabel: (t.auditLog.targets as Record<string, string>)[r.targetType] ?? r.targetType,
    target,
    reference: r.targetId,
    summary: summaryOf(t, r.eventType, target, details),
    details: details.map((d) => ({ label: (t.auditLog.details.labels as Record<string, string>)[d.id] ?? d.id, value: detailValue(t, d) })),
  };
}

const likeEscape = (s: string) => s.replace(/[|%_]/g, (c) => `|${c}`);

/**
 * The SQL conditions for a validated query (parameterised: every value is a bound parameter, never concatenated). `actorIds` are the
 * users whose name matches the search text (resolved by the caller). The free-text search is done in SQL, case-insensitively and with
 * `%`, `_` taken literally (Prisma's JSON `string_contains` is case-sensitive and does not escape wildcards).
 */
export function buildConditions(q: AuditQuery, t: Dictionary, actorIds: string[]): Prisma.Sql[] {
  const c: Prisma.Sql[] = [];
  // Date range: whole local days, the same clock the table shows. `to` is inclusive (the next day's start is the exclusive bound).
  if (q.from) c.push(Prisma.sql`createdAt >= ${localDay(q.from)}`);
  if (q.to) c.push(Prisma.sql`createdAt < ${localDay(q.to, 1)}`);
  if (q.type) c.push(Prisma.sql`eventType = ${q.type}`);
  else if (q.category) c.push(Prisma.sql`eventType IN (${Prisma.join(typesOfCategory(q.category))})`);
  if (q.actor) c.push(Prisma.sql`actorId = ${q.actor}`);
  if (q.target) c.push(Prisma.sql`targetType = ${q.target}`);
  if (q.q) {
    const needle = q.q.toLowerCase();
    const like = `%${likeEscape(needle)}%`;
    const types = AUDIT_EVENT_TYPES.filter((e) => e.toLowerCase().includes(needle) || e.toLowerCase().replace(/_/g, " ").includes(needle) || eventLabel(t, e).toLowerCase().includes(needle));
    const any: Prisma.Sql[] = [
      Prisma.sql`LOWER(targetId) LIKE ${like} ESCAPE '|'`,
      Prisma.sql`LOWER(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.name'))) LIKE ${like} ESCAPE '|'`,
      Prisma.sql`LOWER(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.roleName'))) LIKE ${like} ESCAPE '|'`,
      Prisma.sql`LOWER(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.userName'))) LIKE ${like} ESCAPE '|'`,
      Prisma.sql`LOWER(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.key'))) LIKE ${like} ESCAPE '|'`,
    ];
    if (types.length) any.push(Prisma.sql`eventType IN (${Prisma.join(types)})`);
    if (actorIds.length) any.push(Prisma.sql`actorId IN (${Prisma.join(actorIds)})`);
    c.push(Prisma.sql`(${Prisma.join(any, " OR ")})`);
  }
  return c;
}

/**
 * One page of the log for a validated query, newest first (then by id, so the order is stable). Returns the issues instead when the
 * actor is not one that appears in the log (a forged value) — in that case no event is read.
 */
export async function loadAuditPage(q: AuditQuery, t: Dictionary, dateFormat: string | null | undefined, locale: Locale): Promise<{ ok: true; data: AuditPage } | { ok: false; issues: AuditQueryIssue[]; actors: ActorOption[] }> {
  const actors = await loadActors(t);
  if (q.actor && !actors.some((a) => a.id === q.actor)) return { ok: false, issues: [{ field: "actor", code: "unknownActor" }], actors };

  let actorIds: string[] = [];
  if (q.q) {
    const needle = q.q.toLowerCase();
    // Actors are matched by their CURRENT name; a removed user's name is not stored, so only "Deleted user" can be searched for it.
    const named = actors.filter((a) => !a.deleted && a.name.toLowerCase().includes(needle)).map((a) => a.id);
    const removed = t.auditLog.deletedUser.toLowerCase().includes(needle) ? actors.filter((a) => a.deleted).map((a) => a.id) : [];
    actorIds = [...named, ...removed];
  }
  const conds = buildConditions(q, t, actorIds);
  const where = conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}` : Prisma.empty;
  const [counted, anyEvents] = await Promise.all([db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM audit_events ${where}`, db.auditEvent.findFirst({ select: { id: true } }).then((r) => !!r)]);
  const total = Number(counted[0]?.n ?? 0);
  const last = Math.max(1, Math.ceil(total / q.size));
  const page = Math.min(q.page, last);
  // Newest first, then id (stable). The page's ids are chosen in SQL; the rows are then read by id and put back in that order.
  const ids = total ? (await db.$queryRaw<{ id: string }[]>`SELECT id FROM audit_events ${where} ORDER BY createdAt DESC, id DESC LIMIT ${q.size} OFFSET ${(page - 1) * q.size}`).map((r) => r.id) : [];
  const found = ids.length ? await db.auditEvent.findMany({ where: { id: { in: ids } } }) : [];
  const order = new Map(ids.map((id, i) => [id, i]));
  const rows = found.sort((x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0));
  const byId = new Map(actors.map((a) => [a.id, a]));
  return {
    ok: true,
    data: {
      rows: rows.map((r) => toView(t, r, byId, dateFormat, locale)),
      total,
      page,
      last,
      from: total ? (page - 1) * q.size + 1 : 0,
      to: Math.min(total, page * q.size),
      anyEvents,
      actors,
    },
  };
}
