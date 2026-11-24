import type { PermissionKey } from "@/lib/access";

// Default staff role templates (created only by the Owner's explicit "Initialize default staff roles" action — never silently).
// They are ordinary editable roles marked `isSystem` (can be edited, never deleted). Names are shown in the user's language.

export const TEMPLATE_KEYS = ["CASHIER", "SALESPERSON", "STOREKEEPER", "ACCOUNTANT"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const ROLE_TEMPLATES: Record<TemplateKey, { name: string; description: string; permissions: PermissionKey[] }> = {
  CASHIER: {
    name: "Cashier",
    description: "Sells at the POS and manages the register.",
    permissions: ["dashboard.view", "pos.use", "pos.register.manage", "products.view", "customers.view", "reports.operational.view"],
  },
  SALESPERSON: {
    name: "Salesperson",
    description: "Creates sales, quotations and customer records.",
    permissions: ["dashboard.view", "sales.view", "sales.manage", "sales.returns.manage", "quotations.manage", "customers.view", "customers.manage", "customers.payments.manage", "products.view"],
  },
  STOREKEEPER: {
    name: "Storekeeper",
    description: "Handles stock: purchases, transfers, adjustments and inventory reports.",
    permissions: ["dashboard.view", "products.view", "warehouses.view", "transfers.view", "transfers.manage", "inventory.adjust", "purchases.view", "purchases.manage", "purchases.returns.manage", "suppliers.view", "reports.inventory.view", "barcode.print", "export.use", "cost.view"],
  },
  ACCOUNTANT: {
    name: "Accountant",
    description: "Records payments and expenses and reads the financial reports.",
    permissions: ["dashboard.view", "finance.view", "finance.transactions.record", "expenses.manage", "expenses.categories.manage", "customers.view", "customers.payments.manage", "customers.statement.view", "suppliers.view", "suppliers.payments.manage", "suppliers.statement.view", "reports.financial.view", "cost.view"],
  },
};
