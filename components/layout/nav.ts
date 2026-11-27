// Sidebar navigation — mirrors design/nav.js (SP_NAV + SP_ROUTES), with Next.js routes.

import type { IconName } from "./Icon";
import { canOpenRoute, hasAnyPermission, roleOf, type PermissionKey } from "@/lib/access";
import { HUB_PERMISSIONS } from "@/lib/report-hub";

export type NavLeaf = {
  id: string;
  label: string;
  href: string;
  title?: string;
  /** Shown but not navigable yet (the page isn't built); the text is used as the tooltip. */
  disabled?: string;
  /**
   * Roles that see this entry (default: everyone). UX only — the routes and their Server Actions
   * are protected server-side regardless of what the sidebar shows.
   */
  roles?: readonly NavRole[];
  /**
   * Permissions that show this entry to a USER (any of them). OWNER / ADMIN follow `roles` instead. A USER never sees an entry that has
   * neither a permission nor is the Dashboard. UX only — the proxy and every page / action enforce access on the server.
   */
  perm?: readonly PermissionKey[];
};
export type NavRole = "OWNER" | "ADMIN" | "USER";
export type NavItem =
  | (NavLeaf & { icon: IconName; children?: undefined })
  | { id: string; label: string; icon: IconName; children: NavLeaf[]; href?: undefined; title?: undefined; roles?: readonly NavRole[] };

const STAFF_ADMIN = ["OWNER", "ADMIN"] as const; // Users, Roles & Permissions, Settings
const STAFF = ["OWNER", "ADMIN"] as const; // Finance

export const NAV: NavItem[] = [
  { id: "dash", label: "Dashboard", icon: "layout-dashboard", href: "/dashboard" },
  {
    id: "products",
    label: "Products",
    icon: "package",
    children: [
      { id: "p1", label: "Products", href: "/products", perm: ["products.view", "products.manage"] },
      { id: "p2", label: "Product Categories", href: "/products/categories", perm: ["products.view", "catalog.manage"] },
      { id: "p3", label: "Brands", href: "/products/brands", perm: ["products.view", "catalog.manage"] },
      { id: "p5", label: "Base Units", href: "/base-units", perm: ["products.view", "catalog.manage"] }, // the master list of reusable units (was split across "Units" + "Base Units")
      { id: "p8", label: "Product Unit Conversions", href: "/products/unit-conversions", perm: ["products.view", "catalog.manage"] }, // per-product pack factors overview
      { id: "p7", label: "Product Variants", href: "/products/families", perm: ["products.manage"] }, // grouping of variants: product managers only
      { id: "p6", label: "Print Barcode", href: "/print-barcode", roles: STAFF, perm: ["barcode.print"] }, // barcode labels: OWNER/ADMIN
    ],
  },
  { id: "adj", label: "Adjustments", icon: "sliders-horizontal", href: "/adjustments", perm: ["inventory.adjust"] },
  { id: "quo", label: "Quotations", icon: "file-text", href: "/quotations", roles: STAFF, perm: ["quotations.manage"] }, // customer offers: hidden from USER
  {
    id: "pur",
    label: "Purchases",
    icon: "receipt",
    roles: STAFF, // costs and supplier totals: hidden from USER
    children: [
      { id: "pu1", label: "Purchases", href: "/purchases", perm: ["purchases.view", "purchases.manage"] },
      { id: "pu2", label: "Purchases Returns", href: "/purchases/returns", perm: ["purchases.view", "purchases.returns.manage"] },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    icon: "shopping-cart",
    roles: STAFF, // prices, customer invoices and stock deductions: hidden from USER
    children: [
      { id: "s1", label: "Sales", href: "/sales", perm: ["sales.view", "sales.manage"] },
      { id: "s2", label: "Sales Returns", href: "/sales/returns", perm: ["sales.view", "sales.returns.manage"] },
    ],
  },
  { id: "tr", label: "Transfers", icon: "arrow-left-right", href: "/transfers", perm: ["transfers.view", "transfers.manage"] },
  {
    id: "fin",
    label: "Finance",
    icon: "landmark",
    roles: STAFF,
    children: [
      { id: "f1", label: "Cash & Bank Accounts", href: "/finance/accounts", perm: ["finance.view", "finance.accounts.manage"] },
      { id: "f2", label: "Cash & Bank Transactions", href: "/finance/transactions", perm: ["finance.view", "finance.transactions.record"] },
      { id: "pe4", label: "Supplier Payments", href: "/supplier-payments", roles: STAFF, perm: ["suppliers.payments.manage"] },
      { id: "pe5", label: "Customer Payments", href: "/customer-payments", roles: STAFF, perm: ["customers.payments.manage"] },
      { id: "e1", label: "Expenses", href: "/expenses", perm: ["expenses.manage"] },
      { id: "e2", label: "Expense Categories", href: "/expenses/categories", perm: ["expenses.categories.manage"] },
      { id: "f3", label: "Profit & Loss", href: "/profit-loss", perm: ["reports.financial.view"] },
      // id = the existing nav.costSetup title. A USER sees it only under the full rule (canOpenRoute -> canManageCostBaseline).
      { id: "costSetup", label: "Opening Inventory Cost Setup", href: "/profit-loss/setup", perm: ["cost.baseline.manage"] },
      { id: "f4", label: "Cash Flow", href: "/cash-flow", perm: ["reports.financial.view"] },
      { id: "f5", label: "Receivables & Payables Aging", href: "/receivables-payables-aging", perm: ["reports.financial.view"] },
    ],
  },
  {
    id: "pe",
    label: "Peoples",
    icon: "users",
    children: [
      { id: "pe1", label: "Suppliers", href: "/suppliers", perm: ["suppliers.view", "suppliers.manage"] },
      { id: "pe2", label: "Customers", href: "/customers", perm: ["customers.view", "customers.manage"] },
      { id: "pe3", label: "Users", href: "/users", roles: STAFF_ADMIN },
    ],
  },
  { id: "ro", label: "Roles/Permissions", icon: "shield-check", href: "/roles", title: "Roles", roles: STAFF_ADMIN },
  { id: "wh", label: "Warehouse", icon: "warehouse", href: "/warehouse", perm: ["warehouses.view", "warehouses.manage"] },
  {
    id: "inv",
    label: "Inventory Reports",
    icon: "boxes",
    roles: STAFF, // read-only stock reports: hidden from USER (the pages are protected server-side)
    children: [
      { id: "ir1", label: "Stock Balance by Warehouse", href: "/inventory-reports/stock-balance", perm: ["reports.inventory.view"] },
      { id: "ir2", label: "Product Movement", href: "/inventory-reports/product-movement", perm: ["reports.inventory.view"] },
      { id: "ir3", label: "Low Stock Items", href: "/inventory-reports/low-stock", perm: ["reports.inventory.view"] },
    ],
  },
  { id: "re", label: "Reports", icon: "chart-column", href: "/reports", perm: HUB_PERMISSIONS }, // Report Hub: a USER sees it only with a report permission
  // Not built yet: always disabled and never a link, shown to whoever sees Reports. `href` is only used for that visibility rule.
  { id: "fc", label: "Forecasting & Insights", icon: "clock", href: "/reports", perm: HUB_PERMISSIONS, disabled: "Coming soon" },
  { id: "cu", label: "Currencies", icon: "circle-dollar-sign", href: "/currencies", perm: ["finance.view"] },
  { id: "la", label: "Languages", icon: "languages", href: "/settings/languages", roles: STAFF_ADMIN, perm: ["translations.manage"] },
  { id: "au", label: "Audit Log", icon: "history", href: "/audit-log", roles: STAFF_ADMIN, perm: ["audit.view"] },
  { id: "se", label: "Settings", icon: "settings", href: "/settings", roles: STAFF_ADMIN },
];

export type NavUser = { role?: string | null; permissions?: readonly string[] | null; coversAllWarehouses?: boolean | null };

/**
 * The sidebar items a user may see. OWNER / ADMIN: by `roles` (unchanged). USER: only entries whose `perm` they hold (a group shows
 * when at least one of its entries does); the Dashboard is always there. UX only — routes and actions are protected server-side.
 */
export function visibleNav(user: NavUser | string | undefined): NavItem[] {
  const role = roleOf(user);
  if (role !== "USER") {
    const allowed = (r?: readonly NavRole[]) => !r || r.includes(role as NavRole);
    return NAV.filter((it) => allowed(it.roles)).map((it) => (it.children ? { ...it, children: it.children.filter((c) => allowed(c.roles)) } : it));
  }
  const who = typeof user === "string" ? { role } : user;
  // no permission listed = never shown to a USER; the route gate is applied too (e.g. Profit & Loss also needs cost.view)
  const show = (l: { perm?: readonly PermissionKey[]; href: string }) => !!l.perm && hasAnyPermission(who, l.perm) && canOpenRoute(who, l.href);
  return NAV.flatMap((it): NavItem[] => {
    if (!it.children) return it.id === "dash" || show(it) ? [it] : [];
    const kids = it.children.filter(show);
    return kids.length ? [{ ...it, children: kids }] : [];
  });
}

// Disabled entries are never the current page and never give a topbar title.
const LEAVES: NavLeaf[] = NAV.flatMap((it) => (it.children ? it.children : [it])).filter((l) => !l.disabled);

const matches = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(href + "/");

/**
 * The nav leaf for the current route (e.g. /warehouse/create → Warehouse). The most specific
 * (longest) match wins, so /products/categories is "Product Categories", not "Products".
 */
export function findActive(pathname: string | null): NavLeaf | undefined {
  if (!pathname) return undefined;
  let best: NavLeaf | undefined;
  for (const l of LEAVES) if (matches(pathname, l.href) && (!best || l.href.length > best.href.length)) best = l;
  return best;
}

// Pages that have a topbar title but no sidebar entry (e.g. reached from the user menu).
const EXTRA_TITLES: { href: string; title: string }[] = [
  { href: "/profile", title: "Profile" },
  { href: "/change-password", title: "Change Password" },
  { href: "/settings/theme", title: "Theme Settings" },
  { href: "/preferences", title: "Appearance & Cache" },
  { href: "/suppliers/statement", title: "Supplier Statement" },
  { href: "/reports/supplier-statement", title: "Supplier Statement Report" },
  { href: "/settings/denominations", title: "Cash Denominations" },
  { href: "/customers/statement", title: "Customer Statement" },
  { href: "/reports/customer-statement", title: "Customer Statement Report" },
  { href: "/reports/stock-balance", title: "Stock Balance Report" },
  { href: "/reports/product-movement", title: "Product Movement Report" },
  { href: "/reports/low-stock", title: "Low Stock Report" },
  { href: "/profit-loss/setup", title: "Opening Inventory Cost Setup" },
  { href: "/reports/profit-loss", title: "Profit & Loss Report" },
  { href: "/reports/cash-flow", title: "Cash Flow Report" },
  { href: "/reports/receivables-payables-aging", title: "Aging Report" },
];

/**
 * Topbar title for the current route, translated through the dictionary (dict.nav). The extra pages are
 * checked first because some are nested under a sidebar page (/settings/theme would otherwise show
 * the sidebar Settings entry). The English text here is only a fallback for a missing key.
 */
export function findPageTitle(pathname: string | null, dict?: Record<string, string>): string {
  if (!pathname) return "";
  const extra = EXTRA_TITLES.find((p) => matches(pathname, p.href));
  if (extra) return dict?.[EXTRA_KEYS[extra.href]] ?? extra.title;
  const active = findActive(pathname);
  if (!active) return "";
  return dict?.[active.id === "ro" ? "roTitle" : active.id] ?? active.title ?? active.label;
}
/** Dictionary key (dict.nav) for each extra page title. */
const EXTRA_KEYS: Record<string, string> = {
  "/profile": "profile",
  "/change-password": "changePassword",
  "/settings/theme": "themeSettings",
  "/preferences": "preferences",
  "/suppliers/statement": "supplierStatement",
  "/reports/supplier-statement": "supplierStatementReport",
  "/settings/denominations": "denominations",
  "/customers/statement": "customerStatement",
  "/reports/customer-statement": "customerStatementReport",
  "/reports/stock-balance": "stockBalanceReport",
  "/reports/product-movement": "productMovementReport",
  "/reports/low-stock": "lowStockReport",
  "/profit-loss/setup": "costSetup",
  "/reports/profit-loss": "profitLossReport",
  "/reports/cash-flow": "cashFlowReport",
  "/reports/receivables-payables-aging": "agingReport",
};

/** Id of the group that owns the active leaf, if any. */
export function findOwnerGroup(activeId: string | undefined): string | null {
  if (!activeId) return null;
  const owner = NAV.find((g) => g.children?.some((c) => c.id === activeId));
  return owner ? owner.id : null;
}
