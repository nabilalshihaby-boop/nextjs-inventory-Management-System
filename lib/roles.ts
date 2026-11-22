import type { Role } from "@/app/generated/prisma/client";

// Human-readable labels for the Role enum (shared by the topbar and the profile page).
export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Administrator",
  USER: "User",
};

export function roleLabel(role: string) {
  return ROLE_LABELS[role as Role] ?? role;
}

/** Currencies: every signed-in role may view; only OWNER and ADMIN may create, edit or delete. */
export function canManageCurrencies(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Warehouses: every signed-in role may view; only OWNER and ADMIN may create, edit or delete. */
export function canManageWarehouses(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Product catalog (categories, …): every signed-in role may view; OWNER and ADMIN may change it. */
export function canManageCatalog(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Suppliers: every signed-in role may view/search; only OWNER and ADMIN may create, edit or delete. */
export function canManageSuppliers(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Customers: every signed-in role may view/search; only OWNER and ADMIN may create, edit or delete. */
export function canManageCustomers(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Inventory Reports (stock balance, product movement, low stock): OWNER and ADMIN only; read-only. */
export function canViewInventoryReports(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Products: every signed-in role may view/search; only OWNER and ADMIN may create or edit. */
export function canManageProducts(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/**
 * Inventory transfers: every signed-in role may view/search the history; only OWNER and ADMIN may
 * create, edit/delete pending transfers, send or complete them. Costs are shown to them only.
 */
export function canManageTransfers(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Stock adjustments: every signed-in role may view/search; only OWNER and ADMIN may create, edit or delete. */
export function canManageAdjustments(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/**
 * Finance (Cash & Bank): OWNER and ADMIN may view accounts and transactions; USER may not access
 * Finance at all (routes redirect and no finance data is sent).
 */
export function canViewFinance(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Purchases: OWNER and ADMIN view, create and receive; USER has no access (costs, supplier totals). */
export function canManagePurchases(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Purchase returns: same audience as Purchases — OWNER and ADMIN view and create; USER has no access. */
export function canManagePurchaseReturns(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Supplier payments: OWNER and ADMIN view and record them; USER has no access. */
export function canManageSupplierPayments(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/**
 * Quotations: OWNER and ADMIN view, create, edit/delete drafts and change permitted statuses;
 * USER has no access (customer prices and offers).
 */
export function canManageQuotations(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/**
 * Sales: OWNER and ADMIN view, create, edit/delete pending sales, complete them and convert
 * accepted quotations; USER has no access (prices, customer invoices, stock deductions).
 */
export function canManageSales(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Sales returns: same audience as Sales — OWNER and ADMIN view and create; USER has no access. */
export function canManageSaleReturns(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Customer payments: OWNER and ADMIN view and record them; USER has no access. */
export function canManageCustomerPayments(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Supplier account statement (purchases, returns, payments, balances): OWNER and ADMIN only. */
export function canViewSupplierStatement(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** POS checkout (creates a completed sale + payment + stock/ledger effects): OWNER and ADMIN only. */
export function canUsePos(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Customer account statement (sales, returns, payments, balances): OWNER and ADMIN only. */
export function canViewCustomerStatement(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Expenses (Finance): OWNER and ADMIN view, create, edit and delete; USER has no access. */
export function canManageExpenses(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Expense categories (Finance): OWNER and ADMIN view and manage them; USER has no access. */
export function canManageExpenseCategories(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Cash & bank accounts: OWNER and ADMIN may create, edit, activate or deactivate them (never delete). */
export function canManageCashBankAccounts(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Cash & bank transactions (manual deposit / withdrawal / internal transfer): OWNER and ADMIN. */
export function canRecordCashBankTransactions(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/**
 * Users management (/users and everything under it) is OWNER-only. ADMIN and USER are redirected
 * to /dashboard and never receive user data; every Users Server Action re-checks this.
 */
export function canManageUsers(role: string | undefined): boolean {
  return role === "OWNER";
}

/**
 * System Settings (/settings and everything under it, e.g. /settings/theme) are OWNER-only.
 * ADMIN and USER must never read or change them. Enforced server-side in the settings layout,
 * every settings page and every settings Server Action — not only in the UI or proxy.
 */
export function canManageSystemSettings(role: string | undefined): boolean {
  return role === "OWNER";
}
