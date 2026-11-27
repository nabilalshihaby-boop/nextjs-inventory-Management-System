// The Report Hub catalog (/reports). Only reports with a usable landing page are listed: the POS receipt and the Register Shift
// Report need a sale or session id, so they stay reachable only from their own flows. Each entry reuses the SAME permission helper
// as its page, so the Hub can never offer (or grant) more than the page itself allows. No database access: safe to import anywhere.
import { hasAnyPermission, type PermissionKey, type Who } from "@/lib/access";
import { canViewAging, canViewCashFlow, canViewCustomerStatement, canViewInventoryReports, canViewProfitLoss, canViewSupplierStatement } from "@/lib/roles";

export const REPORT_GROUPS = ["financial", "inventory", "partners"] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];

export const HUB_REPORTS = [
  { id: "profitLoss", group: "financial", href: "/profit-loss", navKey: "f3", icon: "chart-column", can: canViewProfitLoss },
  { id: "cashFlow", group: "financial", href: "/cash-flow", navKey: "f4", icon: "wallet", can: canViewCashFlow },
  { id: "aging", group: "financial", href: "/receivables-payables-aging", navKey: "f5", icon: "clock", can: canViewAging },
  { id: "stockBalance", group: "inventory", href: "/inventory-reports/stock-balance", navKey: "ir1", icon: "boxes", can: canViewInventoryReports },
  { id: "productMovement", group: "inventory", href: "/inventory-reports/product-movement", navKey: "ir2", icon: "history", can: canViewInventoryReports },
  { id: "lowStock", group: "inventory", href: "/inventory-reports/low-stock", navKey: "ir3", icon: "triangle-alert", can: canViewInventoryReports },
  { id: "customerStatement", group: "partners", href: "/customers/statement", navKey: "customerStatement", icon: "users", can: canViewCustomerStatement },
  { id: "supplierStatement", group: "partners", href: "/suppliers/statement", navKey: "supplierStatement", icon: "file-text", can: canViewSupplierStatement },
] as const satisfies readonly { id: string; group: ReportGroup; href: string; navKey: string; icon: string; can: (who: Who) => boolean }[];

/** The permissions that open at least one Hub report: they decide whether a USER sees "Reports" in the sidebar. Not a new permission. */
export const HUB_PERMISSIONS: readonly PermissionKey[] = ["reports.financial.view", "reports.inventory.view", "customers.statement.view", "suppliers.statement.view"];
export const hasHubReport = (who: Who) => hasAnyPermission(who, HUB_PERMISSIONS);

export const hubReportsFor = (who: Who) => HUB_REPORTS.filter((r) => r.can(who));
