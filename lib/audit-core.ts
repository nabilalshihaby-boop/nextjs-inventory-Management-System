import { z } from "zod";
import { isPermissionKey } from "@/lib/access";
import { AUDIT_EVENT_TYPES, type AuditEventType, type AuditTarget } from "@/lib/audit";
import { TEMPLATE_KEYS } from "@/lib/access-templates";
import { REASONS } from "@/lib/product-removal-core";

// Audit Log viewer — pure rules (no database, no React): the query contract (Zod, strict), the event categories and the SAFE reading of
// an event's stored metadata. The viewer is read-only; nothing here writes.
//
// SAFETY MODEL: metadata is never rendered as raw JSON. `safeDetails` reads ONLY the keys listed in KNOWN below, and each value must
// pass its own check (a bounded plain string, a boolean, a non-negative integer, or a list of known permission / template keys). Any
// other key — including anything that looks like a password, hash, token, request body, translated text or connection string — is
// dropped, not displayed. So even a future writer that stores something it should not cannot leak it through this page.

export const AUDIT_TARGETS = ["ROLE", "USER", "SYSTEM", "TRANSLATION", "PRODUCT", "CUSTOMER"] as const satisfies readonly AuditTarget[];
export const AUDIT_CATEGORIES = ["roles", "access", "translations", "products", "customers"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/** Which category each recorded event type belongs to. Exhaustive (typed): a new event type must be placed here. */
export const CATEGORY_OF: Record<AuditEventType, AuditCategory> = {
  ROLE_CREATED: "roles",
  ROLE_UPDATED: "roles",
  ROLE_PERMISSIONS_CHANGED: "roles",
  ROLE_ACTIVATED: "roles",
  ROLE_DEACTIVATED: "roles",
  ROLE_CLONED: "roles",
  ROLE_DELETED: "roles",
  TEMPLATES_INITIALIZED: "roles",
  USER_ROLE_ASSIGNED: "access",
  USER_ROLE_CHANGED: "access",
  USER_ROLE_UNASSIGNED: "access",
  USER_WAREHOUSE_SCOPE_CHANGED: "access",
  TRANSLATION_SAVED: "translations",
  TRANSLATION_RESET: "translations",
  PRODUCT_DELETED: "products",
  PRODUCT_DEACTIVATED: "products",
  PRODUCT_ACTIVATED: "products",
  PRODUCT_BULK_REMOVED: "products",
  PRODUCT_BULK_STATUS: "products",
  CUSTOMER_CREATED: "customers",
};
export const typesOfCategory = (c: AuditCategory): AuditEventType[] => AUDIT_EVENT_TYPES.filter((t) => CATEGORY_OF[t] === c);

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_SEARCH = 80;

/** Validation problems, as codes (the page translates them) plus the offending field. */
export type AuditQueryIssue = { field: string; code: "badDate" | "reversedRange" | "badType" | "badCategory" | "typeNotInCategory" | "badTarget" | "badActor" | "unknownActor" | "badSearch" | "badPage" | "badSize" | "unexpected" | "duplicate" };

export type AuditQuery = {
  from: string; // YYYY-MM-DD or ""
  to: string;
  category: AuditCategory | "";
  type: AuditEventType | "";
  actor: string; // a user id (or the id of a removed user) that appears in the log, or ""
  target: AuditTarget | "";
  q: string;
  page: number;
  size: (typeof PAGE_SIZES)[number];
};
export const NO_QUERY: AuditQuery = { from: "", to: "", category: "", type: "", actor: "", target: "", q: "", page: 1, size: DEFAULT_PAGE_SIZE };

/** The only parameters the page accepts. Anything else is reported, never ignored silently. */
export const QUERY_KEYS = ["from", "to", "category", "type", "actor", "target", "q", "page", "size"] as const;

const isRealDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
};
// A search term is plain text: no control characters, bounded length.
const CONTROL = /[\u0000-\u001f\u007f]/;

const Raw = z.strictObject({
  from: z.string().optional(),
  to: z.string().optional(),
  category: z.string().optional(),
  type: z.string().optional(),
  actor: z.string().optional(),
  target: z.string().optional(),
  q: z.string().optional(),
  page: z.string().optional(),
  size: z.string().optional(),
});

export type ParsedAuditQuery = { ok: true; query: AuditQuery } | { ok: false; issues: AuditQueryIssue[]; query: AuditQuery };

/**
 * Validate the URL's search parameters. Empty values mean "no filter". A repeated parameter, an unknown parameter or a value outside the
 * contract is an issue. On any issue `query` falls back to the defaults (the page then shows the errors and NO events).
 */
export function parseAuditQuery(input: Record<string, string | string[] | undefined>): ParsedAuditQuery {
  const issues: AuditQueryIssue[] = [];
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!(QUERY_KEYS as readonly string[]).includes(k)) {
      // Next.js adds nothing of its own to searchParams, so any other key is the caller's.
      issues.push({ field: k.slice(0, 40), code: "unexpected" });
      continue;
    }
    if (Array.isArray(v)) {
      issues.push({ field: k, code: "duplicate" });
      continue;
    }
    if (typeof v === "string") flat[k] = v;
  }
  const parsed = Raw.safeParse(flat);
  if (!parsed.success) return { ok: false, issues: issues.length ? issues : [{ field: "?", code: "unexpected" }], query: NO_QUERY };
  const r = parsed.data;
  const q: AuditQuery = { ...NO_QUERY };

  for (const k of ["from", "to"] as const) {
    const v = (r[k] ?? "").trim();
    if (v === "") continue;
    if (isRealDate(v)) q[k] = v;
    else issues.push({ field: k, code: "badDate" });
  }
  if (q.from && q.to && q.from > q.to) issues.push({ field: "to", code: "reversedRange" });

  const cat = (r.category ?? "").trim();
  if (cat) {
    if ((AUDIT_CATEGORIES as readonly string[]).includes(cat)) q.category = cat as AuditCategory;
    else issues.push({ field: "category", code: "badCategory" });
  }
  const type = (r.type ?? "").trim();
  if (type) {
    if ((AUDIT_EVENT_TYPES as readonly string[]).includes(type)) q.type = type as AuditEventType;
    else issues.push({ field: "type", code: "badType" });
  }
  if (q.type && q.category && CATEGORY_OF[q.type] !== q.category) issues.push({ field: "type", code: "typeNotInCategory" });

  const target = (r.target ?? "").trim();
  if (target) {
    if ((AUDIT_TARGETS as readonly string[]).includes(target)) q.target = target as AuditTarget;
    else issues.push({ field: "target", code: "badTarget" });
  }
  const actor = (r.actor ?? "").trim();
  if (actor) {
    // Shape only here; that it really appears in the log is checked against the database by the loader.
    if (actor.length <= 191 && /^[A-Za-z0-9_-]+$/.test(actor)) q.actor = actor;
    else issues.push({ field: "actor", code: "badActor" });
  }
  const text = (r.q ?? "").trim();
  if (text) {
    if (text.length > MAX_SEARCH || CONTROL.test(text)) issues.push({ field: "q", code: "badSearch" });
    else q.q = text;
  }
  const page = (r.page ?? "").trim();
  if (page) {
    if (/^[1-9]\d{0,6}$/.test(page)) q.page = Number(page);
    else issues.push({ field: "page", code: "badPage" });
  }
  const size = (r.size ?? "").trim();
  if (size) {
    const n = Number(size);
    if (/^\d{1,3}$/.test(size) && (PAGE_SIZES as readonly number[]).includes(n)) q.size = n as AuditQuery["size"];
    else issues.push({ field: "size", code: "badSize" });
  }
  return issues.length ? { ok: false, issues, query: NO_QUERY } : { ok: true, query: q };
}

/** The query as URL search parameters (only what differs from the defaults) — used for filter links and pagination. */
export function queryString(q: AuditQuery, over: Partial<AuditQuery> = {}): string {
  const m = { ...q, ...over };
  const p = new URLSearchParams();
  for (const k of ["from", "to", "category", "type", "actor", "target", "q"] as const) if (m[k]) p.set(k, m[k]);
  if (m.size !== DEFAULT_PAGE_SIZE) p.set("size", String(m.size));
  if (m.page > 1) p.set("page", String(m.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Start of a local calendar day (the same clock `formatDateTime` shows). `days` shifts it. */
export const localDay = (ymd: string, days = 0) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d + days, 0, 0, 0, 0);
};

// ---------------------------------------------------------------------------------------------
// Safe reading of an event's metadata
// ---------------------------------------------------------------------------------------------

export type Meta = Record<string, unknown>;
const asMeta = (m: unknown): Meta => (m && typeof m === "object" && !Array.isArray(m) ? (m as Meta) : {});

/** A bounded one-line plain string, or null. Control characters are removed and the text is cut (it is only ever rendered as text). */
export function cleanText(v: unknown, max = 120): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
const count = (v: unknown) => (Array.isArray(v) ? v.length : null);
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1_000_000 ? v : null);
const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
/** A translation key: dotted identifier only. */
const keyOf = (v: unknown) => (typeof v === "string" && /^[A-Za-z][A-Za-z0-9_.]{0,119}$/.test(v) ? v : null);
const permKeys = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && isPermissionKey(x)))] : []);
const templateKeys = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && (TEMPLATE_KEYS as readonly string[]).includes(x)))] : []);

/** A language-neutral detail: the viewer turns `id` into a label and formats the value for the active language. */
export type SafeDetail =
  | { id: "name" | "previousName" | "roleName" | "previousRoleName" | "userName" | "clonedFromName" | "key" | "sku"; kind: "text"; value: string }
  | { id: "locale"; kind: "locale"; value: "ar" | "en" }
  | { id: "source"; kind: "source"; value: "POS" }
  | { id: "active" | "hadOverride"; kind: "bool"; value: boolean }
  | { id: "previousLength" | "newLength" | "permissionCount" | "warehousesBefore" | "warehousesAfter" | "requested" | "deleted" | "deactivated" | "unchanged" | "changed"; kind: "number"; value: number }
  | { id: "reasons"; kind: "reasons"; value: string[] }
  | { id: "added" | "removed" | "permissions"; kind: "permissions"; value: string[] }
  | { id: "created" | "template"; kind: "templates"; value: string[] };

/** The safe, structured summary of an event's metadata (an allow-list; see the header). */
export function safeDetails(eventType: string, metadata: unknown): SafeDetail[] {
  const m = asMeta(metadata);
  const out: SafeDetail[] = [];
  const text = (id: Extract<SafeDetail, { kind: "text" }>["id"], v: unknown) => {
    const s = id === "key" ? keyOf(v) : cleanText(v);
    if (s) out.push({ id, kind: "text", value: s });
  };
  text("name", m.name);
  text("previousName", m.previousName);
  text("roleName", m.roleName);
  text("previousRoleName", m.previousRoleName);
  text("userName", m.userName);
  text("clonedFromName", m.clonedFromName);
  text("key", m.key);
  text("sku", m.sku);
  if (m.locale === "ar" || m.locale === "en") out.push({ id: "locale", kind: "locale", value: m.locale });
  if (m.source === "POS") out.push({ id: "source", kind: "source", value: m.source });
  const active = bool(m.active);
  if (active !== null) out.push({ id: "active", kind: "bool", value: active });
  const had = bool(m.hadOverride);
  if (had !== null) out.push({ id: "hadOverride", kind: "bool", value: had });
  const prevLen = int(m.previousLength);
  if (prevLen !== null) out.push({ id: "previousLength", kind: "number", value: prevLen });
  const newLen = int(m.newLength);
  if (newLen !== null) out.push({ id: "newLength", kind: "number", value: newLen });
  for (const id of ["added", "removed"] as const) {
    const k = permKeys(m[id]);
    if (k.length) out.push({ id, kind: "permissions", value: k });
  }
  const perms = permKeys(m.permissions);
  if (perms.length) {
    out.push({ id: "permissionCount", kind: "number", value: perms.length });
    out.push({ id: "permissions", kind: "permissions", value: perms });
  }
  for (const id of ["requested", "deleted", "deactivated", "unchanged", "changed"] as const) {
    const n = int(m[id]);
    if (n !== null) out.push({ id, kind: "number", value: n });
  }
  const why = Array.isArray(m.reasons) ? [...new Set(m.reasons.filter((x): x is string => typeof x === "string" && (REASONS as readonly string[]).includes(x)))] : [];
  if (why.length) out.push({ id: "reasons", kind: "reasons", value: why });
  const tpl = templateKeys(m.created);
  if (tpl.length) out.push({ id: "created", kind: "templates", value: tpl });
  const one = templateKeys([m.template]);
  if (one.length) out.push({ id: "template", kind: "templates", value: one });
  if (eventType === "USER_WAREHOUSE_SCOPE_CHANGED") {
    const b = count(m.before);
    const a = count(m.after);
    if (b !== null) out.push({ id: "warehousesBefore", kind: "number", value: b });
    if (a !== null) out.push({ id: "warehousesAfter", kind: "number", value: a });
  }
  return out;
}

/**
 * The safe human label of an event's target, from what the event itself stored (a snapshot, so it still reads after the role / user is
 * deleted). null when nothing safe is available (the viewer then shows only the target type).
 */
export function targetLabel(targetType: string, targetId: string, metadata: unknown): string | null {
  const m = asMeta(metadata);
  if (targetType === "ROLE") return cleanText(m.name) ?? cleanText(m.roleName);
  if (targetType === "USER") return cleanText(m.userName);
  if (targetType === "TRANSLATION") return keyOf(targetId) ?? keyOf(m.key);
  if (targetType === "PRODUCT") {
    const n = cleanText(m.name);
    const sku = cleanText(m.sku, 64);
    return n && sku ? `${n} (${sku})` : (n ?? sku);
  }
  if (targetType === "CUSTOMER") return cleanText(m.name);
  return null; // SYSTEM: the viewer translates the known references
}
