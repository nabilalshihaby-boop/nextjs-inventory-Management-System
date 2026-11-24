// Dashboard composition (PURE: no database, no React). Decides, from the current user's EFFECTIVE permissions and warehouse scope,
// which sections the dashboard may load and render. The same plan drives the data loader (so an unauthorized section is never even
// queried, let alone serialized) and the page. Nothing here trusts a UI role label: it only calls the central authorization helpers.
import { canOpenRoute, hasPermission, isOwnerOrAdmin, warehouseScopeOf, type PermissionKey, type Who } from "@/lib/access";
import type { IconName } from "@/components/layout/Icon";

export type DashUser = { id?: string | null; role?: string | null; permissions?: readonly string[] | null; warehouseIds?: readonly string[] | null };

export type SectionKey =
  | "sales"
  | "purchases"
  | "expenses"
  | "balances"
  | "receivables"
  | "payables"
  | "lowStock"
  | "pendingWork"
  | "register"
  | "recentSales";

export type ActionKey =
  | "pos" | "newSale" | "newPurchase" | "newCustomer" | "newProduct" | "newTransfer" | "newAdjustment" | "newExpense"
  | "customerPayment" | "supplierPayment" | "lowStockReport" | "cashFlow" | "aging" | "profitLoss" | "accounts";

export type QuickAction = { key: ActionKey; href: string; icon: IconName };

/** [key, href, icon, permission that grants the action itself]. Every href is an existing page; canOpenRoute() is checked as well. */
const ACTIONS: readonly [ActionKey, string, IconName, PermissionKey][] = [
  ["pos", "/pos", "monitor-smartphone", "pos.use"],
  ["newSale", "/sales/create", "shopping-cart", "sales.manage"],
  ["newPurchase", "/purchases/create", "package-plus", "purchases.manage"],
  ["newCustomer", "/customers/create", "users", "customers.manage"],
  ["newProduct", "/products/create", "package", "products.manage"],
  ["newTransfer", "/transfers/create", "arrow-right", "transfers.manage"],
  ["newAdjustment", "/adjustments/create", "arrow-left", "inventory.adjust"],
  ["newExpense", "/expenses/create", "circle-minus", "expenses.manage"],
  ["customerPayment", "/customer-payments/record", "banknote", "customers.payments.manage"],
  ["supplierPayment", "/supplier-payments/record", "hand-coins", "suppliers.payments.manage"],
  ["lowStockReport", "/inventory-reports/low-stock", "bell", "reports.inventory.view"],
  ["cashFlow", "/cash-flow", "dollar-sign", "reports.financial.view"],
  ["aging", "/receivables-payables-aging", "hand-coins", "reports.financial.view"],
  ["profitLoss", "/profit-loss", "dollar-sign", "reports.financial.view"],
  ["accounts", "/finance/accounts", "banknote", "finance.view"],
];

export type DashboardPlan = {
  /** OWNER/ADMIN see everything; "staff" = a USER with an operational role; "onboarding" = a USER with no effective permissions. */
  mode: "full" | "staff" | "onboarding";
  /** May the business figures be loaded at all (OWNER/ADMIN, or an active role that includes dashboard.view). */
  figures: boolean;
  /** A USER limited to specific warehouses: figures that cannot be split by warehouse are not shown to them. */
  limited: boolean;
  sections: ReadonlySet<SectionKey>;
  actions: QuickAction[];
};

export function planDashboard(user: DashUser | null | undefined): DashboardPlan {
  const who: Who = user ?? null;
  const empty: DashboardPlan = { mode: "onboarding", figures: false, limited: false, sections: new Set(), actions: [] };
  if (!user || !user.role) return empty;
  const admin = isOwnerOrAdmin(who);
  const has = (k: PermissionKey) => hasPermission(who, k);
  if (!admin && !(user.permissions?.length ?? 0)) return empty; // a USER without an active role: safe onboarding view only

  const scope = warehouseScopeOf(user);
  const limited = scope !== null && scope.length > 0;
  const figures = admin || has("dashboard.view");
  const sections = new Set<SectionKey>();
  if (figures) {
    if (has("sales.view")) { sections.add("sales"); sections.add("recentSales"); }
    if (has("purchases.view")) sections.add("purchases"); // effectively implies cost.view (central policy)
    if (has("expenses.manage")) sections.add("expenses");
    // Cash/bank balances, receivables and payables cannot be split by warehouse: a warehouse-limited user does not receive them.
    if (!limited && has("finance.view")) sections.add("balances");
    if (!limited && has("reports.financial.view")) sections.add("receivables");
    if (!limited && has("reports.financial.view") && has("cost.view")) sections.add("payables"); // payables are built from purchase (cost) documents
    if (has("reports.inventory.view") || has("warehouses.view")) sections.add("lowStock");
    if (has("transfers.view") || has("sales.view") || has("purchases.view")) sections.add("pendingWork");
    if (has("pos.use") || has("pos.register.manage")) sections.add("register");
  }
  const actions: QuickAction[] = ACTIONS.filter(([, href, , perm]) => has(perm) && canOpenRoute(who, href)).map(([key, href, icon]) => ({ key, href, icon }));
  return { mode: admin ? "full" : "staff", figures, limited, sections, actions };
}

/** Which pending-work counters may be loaded (each needs its own module permission, like the section itself). */
export function pendingParts(user: DashUser | null | undefined) {
  const has = (k: PermissionKey) => hasPermission(user ?? null, k);
  return { transfers: has("transfers.view"), sales: has("sales.view"), purchases: has("purchases.view") };
}

/** Routes the dashboard links to from a section (only rendered as a link when the user may open it). */
export const SECTION_LINKS = {
  sales: "/sales",
  purchases: "/purchases",
  expenses: "/expenses",
  balances: "/finance/accounts",
  receivables: "/receivables-payables-aging",
  payables: "/receivables-payables-aging",
  lowStock: "/inventory-reports/low-stock",
  transfers: "/transfers",
  register: "/pos",
} as const;
export const canLink = (user: DashUser | null | undefined, href: string) => canOpenRoute(user ?? null, href);
