// Pure vocabulary of safe product removal (no database): why a product is kept instead of deleted, and the three possible outcomes.
// Kept apart from lib/product-removal.ts so the audit viewer (a pure reader) can validate the recorded reasons without importing the database.
export const REASONS = ["stock", "stockHistory", "purchases", "purchaseReturns", "sales", "saleReturns", "quotations", "transfers", "adjustments", "heldOrders", "costBaseline"] as const;
export type Reason = (typeof REASONS)[number];
export type Outcome = "DELETE" | "DEACTIVATE" | "KEEP_INACTIVE";
