// Sidebar navigation — mirrors design/nav.js (SP_NAV + SP_ROUTES), with Next.js routes.

import type { IconName } from "./Icon";

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
};
export type NavRole = "OWNER" | "ADMIN" | "USER";
export type NavItem =
  | (NavLeaf & { icon: IconName; children?: undefined })
  | { id: string; label: string; icon: IconName; children: NavLeaf[]; href?: undefined; title?: undefined; roles?: readonly NavRole[] };

const OWNER_ONLY = ["OWNER"] as const; // Users, Settings
const STAFF = ["OWNER", "ADMIN"] as const; // Finance

export const NAV: NavItem[] = [
  { id: "dash", label: "Dashboard", icon: "layout-dashboard", href: "/dashboard" },
  {
    id: "products",
    label: "Products",
    icon: "package",
    children: [
      { id: "p1", label: "Products", href: "/products" },
      { id: "p2", label: "Product Categories", href: "/products/categories" },
      { id: "p3", label: "Brands", href: "/products/brands" },
      { id: "p4", label: "Units", href: "/products/units" },
      { id: "p5", label: "Base Units", href: "/base-units" },
      { id: "p6", label: "Print Barcode", href: "/print-barcode", roles: STAFF }, // barcode labels: OWNER/ADMIN
    ],
  },
  { id: "adj", label: "Adjustments", icon: "sliders-horizontal", href: "/adjustments" },
  { id: "quo", label: "Quotations", icon: "file-text", href: "/quotations", roles: STAFF }, // customer offers: hidden from USER
  {
    id: "pur",
    label: "Purchases",
    icon: "receipt",
    roles: STAFF, // costs and supplier totals: hidden from USER
    children: [
      { id: "pu1", label: "Purchases", href: "/purchases" },
      { id: "pu2", label: "Purchases Returns", href: "/purchases/returns" },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    icon: "shopping-cart",
    roles: STAFF, // prices, customer invoices and stock deductions: hidden from USER
    children: [
      { id: "s1", label: "Sales", href: "/sales" },
      { id: "s2", label: "Sales Returns", href: "/sales/returns" },
    ],
  },
  { id: "tr", label: "Transfers", icon: "arrow-left-right", href: "/transfers" },
  {
    id: "fin",
    label: "Finance",
    icon: "landmark",
    roles: STAFF,
    children: [
      { id: "f1", label: "Cash & Bank Accounts", href: "/finance/accounts" },
      { id: "f2", label: "Cash & Bank Transactions", href: "/finance/transactions" },
      { id: "pe4", label: "Supplier Payments", href: "/supplier-payments", roles: STAFF },
      { id: "pe5", label: "Customer Payments", href: "/customer-payments", roles: STAFF },
      { id: "e1", label: "Expenses", href: "/expenses" },
      { id: "e2", label: "Expense Categories", href: "/expenses/categories" },
      { id: "f3", label: "Profit & Loss", href: "/profit-loss" },
      { id: "f4", label: "Cash Flow", href: "/cash-flow" },
      { id: "f5", label: "Receivables & Payables Aging", href: "/receivables-payables-aging" },
    ],
  },
  {
    id: "pe",
    label: "Peoples",
    icon: "users",
    children: [
      { id: "pe1", label: "Suppliers", href: "/suppliers" },
      { id: "pe2", label: "Customers", href: "/customers" },
      { id: "pe3", label: "Users", href: "/users", roles: OWNER_ONLY },
    ],
  },
  { id: "ro", label: "Roles/Permissions", icon: "shield-check", href: "/roles", title: "Roles" },
  { id: "wh", label: "Warehouse", icon: "warehouse", href: "/warehouse" },
  {
    id: "inv",
    label: "Inventory Reports",
    icon: "boxes",
    roles: STAFF, // read-only stock reports: hidden from USER (the pages are protected server-side)
    children: [
      { id: "ir1", label: "Stock Balance by Warehouse", href: "/inventory-reports/stock-balance" },
      { id: "ir2", label: "Product Movement", href: "/inventory-reports/product-movement" },
      { id: "ir3", label: "Low Stock Items", href: "/inventory-reports/low-stock" },
    ],
  },
  { id: "re", label: "Reports", icon: "chart-column", href: "/reports" },
  { id: "cu", label: "Currencies", icon: "circle-dollar-sign", href: "/currencies" },
  { id: "la", label: "Languages", icon: "languages", href: "/settings/languages", roles: OWNER_ONLY },
  {
    id: "te",
    label: "Templates",
    icon: "file",
    children: [
      { id: "t1", label: "Email Templates", href: "/email-templates" },
      { id: "t2", label: "SMS Templates", href: "/sms-templates" },
    ],
  },
  { id: "se", label: "Settings", icon: "settings", href: "/settings", roles: OWNER_ONLY },
];

/** The sidebar items a role may see (entries restricted to other roles removed). */
export function visibleNav(role: string | undefined): NavItem[] {
  const allowed = (r?: readonly NavRole[]) => !r || r.includes(role as NavRole);
  return NAV.filter((it) => allowed(it.roles)).map((it) => (it.children ? { ...it, children: it.children.filter((c) => allowed(c.roles)) } : it));
}

const LEAVES: NavLeaf[] = NAV.flatMap((it) => (it.children ? it.children : [it]));

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
};

/** Id of the group that owns the active leaf, if any. */
export function findOwnerGroup(activeId: string | undefined): string | null {
  if (!activeId) return null;
  const owner = NAV.find((g) => g.children?.some((c) => c.id === activeId));
  return owner ? owner.id : null;
}
