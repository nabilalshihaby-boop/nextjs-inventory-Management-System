// Sidebar navigation — mirrors design/nav.js (SP_NAV + SP_ROUTES), with Next.js routes.

import type { IconName } from "./Icon";

export type NavLeaf = { id: string; label: string; href: string; title?: string };
export type NavItem =
  | (NavLeaf & { icon: IconName; children?: undefined })
  | { id: string; label: string; icon: IconName; children: NavLeaf[]; href?: undefined; title?: undefined };

export const NAV: NavItem[] = [
  { id: "dash", label: "Dashboard", icon: "layout-dashboard", href: "/dashboard" },
  {
    id: "products",
    label: "Products",
    icon: "package",
    children: [
      { id: "p1", label: "Products", href: "/products" },
      { id: "p2", label: "Product Categories", href: "/product-categories" },
      { id: "p3", label: "Brands", href: "/brands" },
      { id: "p4", label: "Units", href: "/units" },
      { id: "p5", label: "Base Units", href: "/base-units" },
      { id: "p6", label: "Print Barcode", href: "/print-barcode" },
    ],
  },
  { id: "adj", label: "Adjustments", icon: "sliders-horizontal", href: "/adjustments" },
  { id: "quo", label: "Quotations", icon: "file-text", href: "/quotations" },
  {
    id: "pur",
    label: "Purchases",
    icon: "receipt",
    children: [
      { id: "pu1", label: "Purchases", href: "/purchases" },
      { id: "pu2", label: "Purchases Returns", href: "/purchases-returns" },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    icon: "shopping-cart",
    children: [
      { id: "s1", label: "Sales", href: "/sales" },
      { id: "s2", label: "Sales Returns", href: "/sales-returns" },
    ],
  },
  { id: "tr", label: "Transfers", icon: "arrow-left-right", href: "/transfers" },
  {
    id: "ex",
    label: "Expenses",
    icon: "wallet",
    children: [
      { id: "e1", label: "Expenses", href: "/expenses" },
      { id: "e2", label: "Expense Categories", href: "/expense-categories" },
    ],
  },
  {
    id: "fin",
    label: "Finance",
    icon: "landmark",
    children: [
      { id: "f1", label: "Cash & Bank Accounts", href: "/cash-bank-accounts" },
      { id: "f2", label: "Cash & Bank Transactions", href: "/cash-bank-transactions" },
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
      { id: "pe3", label: "Users", href: "/users" },
      { id: "pe4", label: "Supplier Payments", href: "/supplier-payments" },
      { id: "pe5", label: "Customer Payments", href: "/customer-payments" },
    ],
  },
  { id: "ro", label: "Roles/Permissions", icon: "shield-check", href: "/roles", title: "Roles" },
  { id: "wh", label: "Warehouse", icon: "warehouse", href: "/warehouse" },
  { id: "re", label: "Reports", icon: "chart-column", href: "/reports" },
  { id: "cu", label: "Currencies", icon: "circle-dollar-sign", href: "/currencies" },
  { id: "la", label: "Languages", icon: "languages", href: "/languages" },
  {
    id: "te",
    label: "Templates",
    icon: "file",
    children: [
      { id: "t1", label: "Email Templates", href: "/email-templates" },
      { id: "t2", label: "SMS Templates", href: "/sms-templates" },
    ],
  },
  { id: "se", label: "Settings", icon: "settings", href: "/settings" },
];

const LEAVES: NavLeaf[] = NAV.flatMap((it) => (it.children ? it.children : [it]));

const matches = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(href + "/");

/** The nav leaf for the current route (e.g. /warehouse/create → Warehouse). */
export function findActive(pathname: string | null): NavLeaf | undefined {
  if (!pathname) return undefined;
  return LEAVES.find((l) => matches(pathname, l.href));
}

/** Id of the group that owns the active leaf, if any. */
export function findOwnerGroup(activeId: string | undefined): string | null {
  if (!activeId) return null;
  const owner = NAV.find((g) => g.children?.some((c) => c.id === activeId));
  return owner ? owner.id : null;
}
