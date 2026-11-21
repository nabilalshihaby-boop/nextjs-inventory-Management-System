-- Initial inventory from the CSV product import is NOT a purchase: it has no supplier. Stock entries
-- therefore get an explicit source, and the supplier becomes optional (existing rows keep their supplier
-- and the PRODUCT_FORM source; no data is changed).
ALTER TABLE `product_stock_entries` ADD COLUMN `source` ENUM('PRODUCT_FORM', 'INITIAL_STOCK') NOT NULL DEFAULT 'PRODUCT_FORM',
    MODIFY `supplierId` VARCHAR(191) NULL;
