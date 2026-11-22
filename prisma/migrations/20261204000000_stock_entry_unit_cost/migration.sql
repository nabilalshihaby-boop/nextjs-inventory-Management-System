-- Cost-per-base-unit snapshot of newly recorded opening / initial stock (Profit & Loss, Moving Weighted Average).
-- Additive and nullable: existing rows stay NULL (cost unknown) and are never back-filled from Product.cost.
ALTER TABLE `product_stock_entries` ADD COLUMN `unitCost` DECIMAL(14, 2) NULL;
