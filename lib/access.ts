// The central authorization layer (server-side truth; safe to import anywhere — it has no database access).
//
// Platform roles are unchanged: OWNER (full access, never restricted), ADMIN (everything it could do before — kept exactly), USER.
// A USER gains OPERATIONAL access only through the permissions of the AccessRole the Owner assigned to them, and may additionally be
// limited to some warehouses. Permission keys are a closed, typed catalog: anything else is rejected, never stored or trusted.
// System configuration, user management, role management, translation management, reset, licensing and any future control panel are
// Owner-only and are deliberately NOT in this catalog (they can't be granted).

export const PERMISSION_GROUPS = ["dashboard", "pos", "sales", "customers", "purchases", "suppliers", "products", "warehouses", "finance", "reports", "output", "system"] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

/** [group, key, warehouse-scoped?]. A scoped permission touches warehouse-bound data, so it is limited to the user's assigned warehouses. */
const DEFINITIONS = [
  ["dashboard", "dashboard.view", false],
  ["pos", "pos.use", true],
  ["pos", "pos.register.manage", true],
  ["sales", "sales.view", true],
  ["sales", "sales.manage", true],
  ["sales", "sales.returns.manage", true],
  ["sales", "quotations.manage", true],
  ["customers", "customers.view", false],
  ["customers", "customers.manage", false],
  ["customers", "customers.create", false],
  ["customers", "customers.payments.manage", false],
  ["customers", "customers.statement.view", false],
  ["purchases", "purchases.view", true],
  ["purchases", "purchases.manage", true],
  ["purchases", "purchases.returns.manage", true],
  ["suppliers", "suppliers.view", false],
  ["suppliers", "suppliers.manage", false],
  ["suppliers", "suppliers.payments.manage", false],
  ["suppliers", "suppliers.statement.view", false],
  ["products", "products.view", false],
  ["products", "products.manage", false],
  ["products", "catalog.manage", false],
  ["products", "cost.view", false],
  ["warehouses", "warehouses.view", true],
  ["warehouses", "warehouses.manage", true],
  ["warehouses", "transfers.view", true],
  ["warehouses", "transfers.manage", true],
  ["warehouses", "inventory.adjust", true],
  ["finance", "finance.view", false],
  ["finance", "finance.transactions.record", false],
  ["finance", "finance.accounts.manage", false],
  ["finance", "expenses.manage", false],
  ["finance", "expenses.categories.manage", false],
  ["finance", "reports.financial.view", false],
  // Company-wide (one baseline for all stock): marked scoped so the user can be assigned warehouses, and EVERY one is required.
  ["finance", "cost.baseline.manage", true],
  ["reports", "reports.inventory.view", true],
  ["reports", "reports.operational.view", true],
  ["output", "export.use", true],
  ["output", "barcode.print", false],
  ["system", "translations.manage", false],
  ["system", "audit.view", false],
] as const;

export type PermissionKey = (typeof DEFINITIONS)[number][1];
export const PERMISSION_KEYS: readonly PermissionKey[] = DEFINITIONS.map((d) => d[1]);
const KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);
const SCOPED: ReadonlySet<string> = new Set(DEFINITIONS.filter((d) => d[2]).map((d) => d[1]));
export const PERMISSIONS_BY_GROUP: Record<PermissionGroup, PermissionKey[]> = Object.fromEntries(PERMISSION_GROUPS.map((g) => [g, DEFINITIONS.filter((d) => d[0] === g).map((d) => d[1])])) as Record<PermissionGroup, PermissionKey[]>;

/**
 * COST VISIBILITY POLICY (one place). `cost.view` is the only permission that lets a USER receive product cost, purchase cost,
 * transfer unit cost, cost-based valuation, COGS or profit. These permissions work directly on cost data (a product's cost is a required
 * input, a purchase IS a cost entry, a transfer shows its unit-cost snapshot), so they are only effective together with cost.view:
 *  - the role form selects cost.view automatically and the server adds it when a role is saved;
 *  - at request time a role that somehow lacks it loses these permissions (fail closed), see effectivePermissions().
 * Everything else (sales, POS, quotations, inventory reports, product list, warehouse stock) never carries cost at all.
 */
export const COST_REQUIRED: readonly PermissionKey[] = ["products.manage", "purchases.view", "purchases.manage", "purchases.returns.manage", "transfers.manage"];
const COST_REQUIRED_SET: ReadonlySet<string> = new Set(COST_REQUIRED);
export const requiresCostView = (keys: readonly string[]) => keys.some((k) => COST_REQUIRED_SET.has(k));
/** Role-save normalisation: a role that includes a cost-handling permission always includes cost.view. */
export function withRequiredPermissions(keys: readonly PermissionKey[]): PermissionKey[] {
  const out = [...new Set(keys)];
  if (requiresCostView(out) && !out.includes("cost.view")) out.push("cost.view");
  return out;
}
/** Request-time view of a role's permissions: without cost.view the cost-handling permissions are not granted. */
export function effectivePermissions(keys: readonly string[]): string[] {
  return keys.includes("cost.view") ? [...keys] : keys.filter((k) => !COST_REQUIRED_SET.has(k));
}

export const isPermissionKey = (v: unknown): v is PermissionKey => typeof v === "string" && KEY_SET.has(v);
/** Keep only real catalog keys (unknown strings are dropped, never trusted). */
export const onlyKnownKeys = (keys: readonly string[]): PermissionKey[] => [...new Set(keys)].filter(isPermissionKey);
export const isScopedPermission = (k: string) => SCOPED.has(k);
/** True when at least one of the permissions works on warehouse-bound data (the user then needs assigned warehouses). */
export const needsWarehouseScope = (keys: readonly string[]) => keys.some((k) => SCOPED.has(k));

// ---------------------------------------------------------------------------------------------
// Who is asking
// ---------------------------------------------------------------------------------------------

/** What helpers accept: a bare platform role (legacy call sites) or the session user, which also carries the resolved permissions. */
export type Who = string | null | undefined | { role?: string | null; permissions?: readonly string[] | null; coversAllWarehouses?: boolean | null };

export const roleOf = (who: Who): string | undefined => (typeof who === "string" ? who : (who?.role ?? undefined));
export const isOwner = (who: Who) => roleOf(who) === "OWNER";
export const isOwnerOrAdmin = (who: Who) => roleOf(who) === "OWNER" || roleOf(who) === "ADMIN";

/**
 * The one permission check. OWNER always passes; ADMIN keeps every operational capability it has today (it passes all catalog
 * permissions); USER passes only with the permission from its assigned, ACTIVE role (resolved from the database on every request).
 */
export function hasPermission(who: Who, key: PermissionKey): boolean {
  const r = roleOf(who);
  if (r === "OWNER" || r === "ADMIN") return true;
  if (r !== "USER" || typeof who === "string" || !who) return false;
  return !!who.permissions?.includes(key);
}
export const hasAnyPermission = (who: Who, keys: readonly PermissionKey[]) => keys.some((k) => hasPermission(who, k));

/**
 * Opening Inventory Cost Setup (the one rule for its page, actions, route gate, button and sidebar entry). OWNER / ADMIN always.
 * A USER needs ALL of: cost.view, cost.baseline.manage, and every warehouse assigned (the baseline is company-wide).
 * `coversAllWarehouses` is resolved from the database on every request (lib/access-server.ts); absent means no.
 */
export function canManageCostBaseline(who: Who): boolean {
  if (isOwnerOrAdmin(who)) return true;
  return typeof who !== "string" && !!who?.coversAllWarehouses && hasPermission(who, "cost.view") && hasPermission(who, "cost.baseline.manage");
}

/** The warehouses a user is limited to: null = unrestricted (OWNER / ADMIN), otherwise the assigned ids (possibly none). */
export type WarehouseScope = readonly string[] | null;
export type AccessUser = { role?: string | null; warehouseIds?: readonly string[] | null };
export function warehouseScopeOf(user: AccessUser | null | undefined): WarehouseScope {
  if (!user) return [];
  if (user.role === "OWNER" || user.role === "ADMIN") return null;
  return user.warehouseIds ?? [];
}
export const inWarehouseScope = (user: AccessUser | null | undefined, warehouseId: string | null | undefined) => {
  const s = warehouseScopeOf(user);
  return s === null || (!!warehouseId && s.includes(warehouseId));
};
/** Every id must be inside the scope (a transfer needs both warehouses). */
export const allInWarehouseScope = (user: AccessUser | null | undefined, ids: readonly (string | null | undefined)[]) => ids.every((i) => inWarehouseScope(user, i));
/** A Prisma `where` fragment limiting a `warehouseId` column to the scope ({} when unrestricted). */
export const warehouseWhere = (user: AccessUser | null | undefined): { warehouseId?: { in: string[] } } => {
  const s = warehouseScopeOf(user);
  return s === null ? {} : { warehouseId: { in: [...s] } };
};

// ---------------------------------------------------------------------------------------------
// Route gate (used by proxy.ts for every request of a signed-in USER). Coarse by design: a module's pages are reachable with any of
// its view/manage permissions; the fine "can this user create / edit / delete" rule stays in each page and Server Action.
// Anything not listed is denied to a USER (default deny) — a new route can never become reachable by accident.
// ---------------------------------------------------------------------------------------------

type Rule = { match: (p: string) => boolean; any: readonly PermissionKey[]; all?: readonly PermissionKey[] };
const under = (prefix: string) => (p: string) => p === prefix || p.startsWith(`${prefix}/`);
const rule = (prefixes: string[], any: PermissionKey[], all?: PermissionKey[]): Rule => ({ match: (p) => prefixes.some((x) => under(x)(p)), any, all });

/** Reachable by every signed-in user (their own profile, preferences, password, the safe dashboard shell and uploaded images). */
const ALWAYS = ["/dashboard", "/profile", "/change-password", "/preferences", "/uploads"];
/** Business-administration areas: OWNER and ADMIN only, never a USER regardless of any role. */
const ADMIN_AREAS = ["/users", "/roles", "/settings"];
/** OWNER-only (platform) areas: the reserved prefixes of the future Control Panel (deployment / database
 *  connection, licensing, factory reset, backup destinations, releases, secrets). The reserved prefixes have no pages yet; keeping them
 *  closed here means a future page can never become reachable by an ADMIN by accident. */
const PLATFORM_ONLY = ["/control-panel", "/platform", "/licensing", "/backup", "/backups", "/database", "/factory-reset", "/releases", "/deployment", "/secrets"];

const RULES: Rule[] = [
  { match: (p) => /^\/warehouse\/[^/]+\/export$/.test(p), any: ["export.use"] },
  rule(["/products/import"], ["products.manage"]),
  rule(["/products/families"], ["products.manage"]),
  rule(["/pos"], ["pos.use", "pos.register.manage"]),
  rule(["/reports/pos-receipt"], ["pos.use", "reports.operational.view", "sales.view"]),
  rule(["/reports/register-session"], ["pos.register.manage", "reports.operational.view"]),
  rule(["/sales/returns"], ["sales.view", "sales.returns.manage"]),
  rule(["/sales"], ["sales.view", "sales.manage"]),
  rule(["/quotations"], ["quotations.manage"]),
  rule(["/customer-payments"], ["customers.payments.manage"]),
  rule(["/customers/statement", "/reports/customer-statement"], ["customers.statement.view"]),
  rule(["/customers"], ["customers.view", "customers.manage"]),
  rule(["/purchases/returns"], ["purchases.view", "purchases.returns.manage"]),
  rule(["/purchases"], ["purchases.view", "purchases.manage"]),
  rule(["/supplier-payments"], ["suppliers.payments.manage"]),
  rule(["/suppliers/statement", "/reports/supplier-statement"], ["suppliers.statement.view"]),
  rule(["/suppliers"], ["suppliers.view", "suppliers.manage"]),
  rule(["/print-barcode"], ["products.view", "products.manage"], ["barcode.print"]),
  // Catalog reference pages first. Everything else under /products shows product names and SKUs (the list, records and Product Unit
  // Conversions) and needs a product permission: catalog.manage alone is not one.
  rule(["/products/categories", "/products/brands", "/products/units", "/base-units"], ["products.view", "products.manage", "catalog.manage"]),
  rule(["/products"], ["products.view", "products.manage"]),
  rule(["/warehouse"], ["warehouses.view", "warehouses.manage"]),
  rule(["/transfers"], ["transfers.view", "transfers.manage"]),
  rule(["/adjustments"], ["inventory.adjust"]),
  rule(["/inventory-reports", "/reports/stock-balance", "/reports/product-movement", "/reports/low-stock"], ["reports.inventory.view"]),
  // Profit & Loss exposes COGS, gross and net profit: it needs cost.view on top of the financial-reports permission.
  rule(["/profit-loss", "/reports/profit-loss"], ["reports.financial.view"], ["cost.view"]),
  rule(["/cash-flow", "/receivables-payables-aging", "/reports/cash-flow", "/reports/receivables-payables-aging"], ["reports.financial.view"]),
  // Cash & Bank needs finance.view. Recording / account management alone opens nothing here (their refusals can quote balances).
  rule(["/finance"], ["finance.view"]),
  rule(["/expenses/categories"], ["expenses.categories.manage"]),
  rule(["/expenses"], ["expenses.manage"]),
  rule(["/currencies"], ["finance.view"]),
  // Audit Log (read-only viewer of recorded system activity): its own permission, never implied by another one.
  rule(["/audit-log"], ["audit.view"]),
];

const normalize = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p) || "/";

/** May this signed-in user open this path? (OWNER: always; ADMIN: everything except the platform-only areas; USER: only what its role grants.) */
export function canOpenRoute(who: Who, pathname: string): boolean {
  const p = normalize(pathname);
  const r = roleOf(who);
  if (r === "OWNER") return true;
  if (PLATFORM_ONLY.some((o) => under(o)(p))) return false; // platform-only: OWNER alone, ADMIN included
  if (r === "ADMIN") return true;
  if (r !== "USER") return false;
  if (ALWAYS.some((a) => under(a)(p))) return true;
  // The Report Hub page itself (exact path, NOT the reports below it): it lists only what the user may open and reads no data.
  if (p === "/reports") return true;
  // Decided here, before the RULES: the wider /profit-loss rule must not open it, and reports.financial.view is not what grants it.
  if (under("/profit-loss/setup")(p)) return canManageCostBaseline(who);
  // Translation Management is its own permission (translations.manage): ADMIN has it, a USER only through an assigned role.
  if (under("/settings/languages")(p)) return hasPermission(who, "translations.manage");
  if (ADMIN_AREAS.some((o) => under(o)(p))) return false;
  const hit = RULES.find((x) => x.match(p));
  return !!hit && hasAnyPermission(who, hit.any) && (hit.all ?? []).every((k) => hasPermission(who, k));
}
