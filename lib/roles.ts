import type { Role } from "@/app/generated/prisma/client";
import { canManageCostBaseline, hasPermission, isOwner, isOwnerOrAdmin, type PermissionKey, type Who } from "@/lib/access";

// Human-readable labels for the Role enum (shared by the topbar and the profile page).
export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Administrator",
  USER: "User",
};

export function roleLabel(role: string) {
  return ROLE_LABELS[role as Role] ?? role;
}

// Authorization helpers. Every page, report, export and Server Action calls one of these with the SESSION USER (`session.user`),
// which carries the platform role and the permissions resolved from the database on this very request (auth.ts). A legacy call with
// only a role string still works and means "no operational permissions".
//   OWNER  → always allowed.
//   ADMIN  → allowed exactly where it was allowed before this module existed (all of the operational helpers below).
//   USER   → allowed only with the matching permission of its assigned, ACTIVE access role.
// Administration (users, roles, system settings) is not a permission and can't be granted.
const needs = (key: PermissionKey) => (who: Who) => hasPermission(who, key);
const adminOnly = (who: Who) => isOwnerOrAdmin(who);
const ownerOnly = (who: Who) => isOwner(who);

/** Currencies: view is part of finance access; only OWNER and ADMIN may create, edit or delete. */
export const canManageCurrencies = adminOnly;
/** Warehouses: create, edit, delete. */
export const canManageWarehouses = needs("warehouses.manage");
/** Product catalog (categories, brands, units, base units): create, edit, delete. */
export const canManageCatalog = needs("catalog.manage");
export const canManageSuppliers = needs("suppliers.manage");
export const canManageCustomers = needs("customers.manage");
/** Create a customer (POS quick add): the narrow customers.create permission, or the broader customers.manage that already includes creating. */
export const canCreateCustomers = (who: Who) => hasPermission(who, "customers.create") || hasPermission(who, "customers.manage");
/** Inventory Reports (stock balance, product movement, low stock): read-only. */
export const canViewInventoryReports = needs("reports.inventory.view");
/** Profit & Loss, Cash Flow and Aging expose costs, margins, expenses and every unpaid balance: read-only. */
export const canViewProfitLoss = (who: Who) => hasPermission(who, "reports.financial.view") && hasPermission(who, "cost.view");
export const canViewCashFlow = needs("reports.financial.view");
export const canViewAging = needs("reports.financial.view");
/** Opening Inventory Cost Setup (Profit & Loss cutover): OWNER / ADMIN, or a USER meeting the full rule in canManageCostBaseline. */
export const canSetCostBaseline = canManageCostBaseline;
export const canManageProducts = needs("products.manage");
/** Inventory transfers: create, edit/delete pending ones, send or complete them. */
export const canManageTransfers = needs("transfers.manage");
export const canManageAdjustments = needs("inventory.adjust");
/** Finance (Cash & Bank accounts and transactions): view. */
export const canViewFinance = needs("finance.view");
export const canManagePurchases = needs("purchases.manage");
export const canManagePurchaseReturns = needs("purchases.returns.manage");
export const canManageSupplierPayments = needs("suppliers.payments.manage");
export const canManageQuotations = needs("quotations.manage");
export const canManageSales = needs("sales.manage");
export const canManageSaleReturns = needs("sales.returns.manage");
export const canManageCustomerPayments = needs("customers.payments.manage");
export const canViewSupplierStatement = needs("suppliers.statement.view");
export const canViewCustomerStatement = needs("customers.statement.view");
export const canUsePos = needs("pos.use");
/** POS register: open / close a session, Cash In / Cash Out. */
export const canManagePosRegister = needs("pos.register.manage");
export const canManageExpenses = needs("expenses.manage");
export const canManageExpenseCategories = needs("expenses.categories.manage");
export const canManageCashBankAccounts = needs("finance.accounts.manage");
export const canRecordCashBankTransactions = needs("finance.transactions.record");
/** Cost data (product costs, purchase costs, transfer unit costs). */
export const canViewCost = needs("cost.view");
/** CSV / file exports (warehouse export). */
export const canExport = needs("export.use");
/** Barcode labels: barcode.print on top of being able to view products. Read-only; it grants no product or catalog editing. */
export const canPrintBarcodes = (who: Who) => hasPermission(who, "barcode.print") && canViewProducts(who);
export const canViewProducts = (who: Who) => hasPermission(who, "products.view") || hasPermission(who, "products.manage");

// READ access to sales and purchase documents (lists and details). It never implies a mutation: every create / edit / complete /
// receive / return / payment control and Server Action keeps its own manage permission. Purchases are cost data, so cost.view too.
export const canViewSales = (who: Who) => hasPermission(who, "sales.view") || hasPermission(who, "sales.manage");
export const canViewSaleReturns = (who: Who) => hasPermission(who, "sales.view") || hasPermission(who, "sales.returns.manage");
export const canViewPurchases = (who: Who) => hasPermission(who, "cost.view") && (hasPermission(who, "purchases.view") || hasPermission(who, "purchases.manage"));
export const canViewPurchaseReturns = (who: Who) => hasPermission(who, "cost.view") && (hasPermission(who, "purchases.view") || hasPermission(who, "purchases.returns.manage"));

/** Users: OWNER and ADMIN manage ADMIN / USER accounts (the OWNER account itself is never touched, see users/actions.ts). */
export const canManageUsers = adminOnly;
/** Roles & Permissions (operational roles, templates, warehouse assignments, role audit): OWNER and ADMIN. Never grantable to a USER. */
export const canManageRoles = adminOnly;
/** Business system settings (company data, default currency, organization-wide theme, denominations): OWNER and ADMIN. */
export const canManageSystemSettings = adminOnly;
/** Translation Management (Arabic overrides): the translations.manage permission. OWNER and ADMIN have it; a USER only through an assigned role. */
export const canManageTranslations = needs("translations.manage");
/** Audit Log viewer (read-only): the audit.view permission. OWNER and ADMIN have it; a USER only through an assigned role (never in a default template). */
export const canViewAudit = needs("audit.view");
/** Platform / future Control Panel capabilities (deployment and database connection, licensing, factory reset, backup destinations and
 *  credentials, releases, secrets): OWNER only. No such pages exist yet; the route prefixes are already closed to ADMIN in lib/access.ts. */
export const canManagePlatform = ownerOnly;
