import type { Role } from "@/app/generated/prisma/client";
import { hasPermission, isOwner, isOwnerOrAdmin, type PermissionKey, type Who } from "@/lib/access";

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
// Owner-only capabilities (users, roles, system settings, opening cost baseline) are not permissions and can't be granted.
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
/** Inventory Reports (stock balance, product movement, low stock): read-only. */
export const canViewInventoryReports = needs("reports.inventory.view");
/** Profit & Loss, Cash Flow and Aging expose costs, margins, expenses and every unpaid balance: read-only. */
export const canViewProfitLoss = (who: Who) => hasPermission(who, "reports.financial.view") && hasPermission(who, "cost.view");
export const canViewCashFlow = needs("reports.financial.view");
export const canViewAging = needs("reports.financial.view");
/** Opening Inventory Cost Setup (Profit & Loss cutover): OWNER only. */
export const canSetCostBaseline = ownerOnly;
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
export const canPrintBarcodes = needs("barcode.print");
export const canViewProducts = (who: Who) => hasPermission(who, "products.view") || hasPermission(who, "products.manage");

/** Users: OWNER only. */
export const canManageUsers = ownerOnly;
/** Roles & Permissions: OWNER only (never grantable, not even to ADMIN). */
export const canManageRoles = ownerOnly;
/** System Settings (company data, default currency, theme, denominations, languages): OWNER only. */
export const canManageSystemSettings = ownerOnly;
