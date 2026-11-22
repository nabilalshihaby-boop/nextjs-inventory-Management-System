-- Product unit conversions (per-product base unit + conversion factors) and per-line unit snapshots.
--
-- Strategy: ADDITIVE ONLY. Nothing is deleted or rewritten: stock quantities (product_stocks, opening entries),
-- document quantities, prices, costs, references and ledger rows keep their exact values. Existing lines are
-- treated as factor 1 (baseQuantity = quantity, unitFactor = 1, unitId NULL = legacy). Every product's current unit
-- (products.productUnitId) becomes its Base Unit with a factor-1 conversion row; a sale/purchase unit that differs
-- from it gets a factor-1 row too (historically it was only a label), which the owner may deactivate afterwards.
-- The migration FAILS (rolls back with a CHECK error) instead of continuing if any invariant is not met.

-- AlterTable
ALTER TABLE `stock_transfer_items` ADD COLUMN `baseQuantity` DECIMAL(14, 3) NOT NULL,
    ADD COLUMN `unitFactor` DECIMAL(16, 6) NOT NULL DEFAULT 1,
    ADD COLUMN `unitId` VARCHAR(191) NULL,
    ADD COLUMN `unitName` VARCHAR(64) NULL;

-- AlterTable
ALTER TABLE `stock_adjustment_items` ADD COLUMN `baseQuantity` DECIMAL(14, 3) NOT NULL,
    ADD COLUMN `unitFactor` DECIMAL(16, 6) NOT NULL DEFAULT 1,
    ADD COLUMN `unitId` VARCHAR(191) NULL,
    ADD COLUMN `unitName` VARCHAR(64) NULL;

-- AlterTable
ALTER TABLE `purchase_items` ADD COLUMN `baseQuantity` DECIMAL(14, 3) NOT NULL,
    ADD COLUMN `unitFactor` DECIMAL(16, 6) NOT NULL DEFAULT 1,
    ADD COLUMN `unitId` VARCHAR(191) NULL,
    ADD COLUMN `unitName` VARCHAR(64) NULL;

-- AlterTable
ALTER TABLE `purchase_return_items` ADD COLUMN `baseQuantity` DECIMAL(14, 3) NOT NULL,
    ADD COLUMN `unitFactor` DECIMAL(16, 6) NOT NULL DEFAULT 1,
    ADD COLUMN `unitId` VARCHAR(191) NULL,
    ADD COLUMN `unitName` VARCHAR(64) NULL;

-- AlterTable
ALTER TABLE `sale_items` ADD COLUMN `baseQuantity` DECIMAL(14, 3) NOT NULL,
    ADD COLUMN `unitFactor` DECIMAL(16, 6) NOT NULL DEFAULT 1,
    ADD COLUMN `unitId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `sale_return_items` ADD COLUMN `baseQuantity` DECIMAL(14, 3) NOT NULL,
    ADD COLUMN `unitFactor` DECIMAL(16, 6) NOT NULL DEFAULT 1,
    ADD COLUMN `unitId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `pos_held_order_items` ADD COLUMN `unitId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `product_unit_conversions` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `unitId` VARCHAR(191) NOT NULL,
    `factor` DECIMAL(16, 6) NOT NULL,
    `isBase` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `forSales` BOOLEAN NOT NULL DEFAULT true,
    `forPurchases` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `product_unit_conversions_unitId_idx`(`unitId`),
    UNIQUE INDEX `product_unit_conversions_productId_unitId_key`(`productId`, `unitId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `product_unit_conversions` ADD CONSTRAINT `product_unit_conversions_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_unit_conversions` ADD CONSTRAINT `product_unit_conversions_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `product_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- DATA MIGRATION (inserts and a backfill of the new columns only)
-- ---------------------------------------------------------------------------------------------

-- 1. Base unit conversion row (factor 1) for every product.
INSERT INTO `product_unit_conversions` (`id`, `productId`, `unitId`, `factor`, `isBase`, `active`, `forSales`, `forPurchases`, `createdAt`, `updatedAt`)
SELECT UUID(), p.`id`, p.`productUnitId`, 1, TRUE, TRUE, TRUE, TRUE, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3) FROM `products` p;

-- 2. A different default sale unit keeps working: factor 1 (history is never reinterpreted).
INSERT INTO `product_unit_conversions` (`id`, `productId`, `unitId`, `factor`, `isBase`, `active`, `forSales`, `forPurchases`, `createdAt`, `updatedAt`)
SELECT UUID(), p.`id`, p.`saleUnitId`, 1, FALSE, TRUE, TRUE, (p.`purchaseUnitId` = p.`saleUnitId`), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `products` p WHERE p.`saleUnitId` <> p.`productUnitId`;

-- 3. A default purchase unit that is neither the base unit nor the sale unit.
INSERT INTO `product_unit_conversions` (`id`, `productId`, `unitId`, `factor`, `isBase`, `active`, `forSales`, `forPurchases`, `createdAt`, `updatedAt`)
SELECT UUID(), p.`id`, p.`purchaseUnitId`, 1, FALSE, TRUE, FALSE, TRUE, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `products` p WHERE p.`purchaseUnitId` <> p.`productUnitId` AND p.`purchaseUnitId` <> p.`saleUnitId`;

-- 4. Existing lines: base quantity = the quantity they already had (factor 1).
UPDATE `purchase_items` SET `baseQuantity` = `quantity`;
UPDATE `purchase_return_items` SET `baseQuantity` = `quantity`;
UPDATE `sale_items` SET `baseQuantity` = `quantity`;
UPDATE `sale_return_items` SET `baseQuantity` = `quantity`;
UPDATE `stock_transfer_items` SET `baseQuantity` = `quantity`;
UPDATE `stock_adjustment_items` SET `baseQuantity` = `quantity`;

-- ---------------------------------------------------------------------------------------------
-- VALIDATION: a failed CHECK aborts the migration (nothing is silently corrupted).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE `_unit_migration_guard` (`what` VARCHAR(64) NOT NULL, `ok` TINYINT NOT NULL, CONSTRAINT `chk_unit_migration_ok` CHECK (`ok` = 1));

INSERT INTO `_unit_migration_guard` (`what`, `ok`) SELECT 'every product has exactly one factor-1 base conversion on its current unit',
  ((SELECT COUNT(*) FROM `products` p WHERE (SELECT COUNT(*) FROM `product_unit_conversions` c WHERE c.`productId` = p.`id` AND c.`isBase` = TRUE AND c.`unitId` = p.`productUnitId` AND c.`factor` = 1) <> 1) = 0);
INSERT INTO `_unit_migration_guard` (`what`, `ok`) SELECT 'sale and purchase default units have an active conversion',
  ((SELECT COUNT(*) FROM `products` p WHERE NOT EXISTS (SELECT 1 FROM `product_unit_conversions` c WHERE c.`productId` = p.`id` AND c.`unitId` = p.`saleUnitId` AND c.`active` = TRUE)
      OR NOT EXISTS (SELECT 1 FROM `product_unit_conversions` c WHERE c.`productId` = p.`id` AND c.`unitId` = p.`purchaseUnitId` AND c.`active` = TRUE)) = 0);
INSERT INTO `_unit_migration_guard` (`what`, `ok`) SELECT 'purchase_items quantities unchanged', ((SELECT COUNT(*) FROM `purchase_items` WHERE `baseQuantity` <> `quantity` OR `unitFactor` <> 1) = 0);
INSERT INTO `_unit_migration_guard` (`what`, `ok`) SELECT 'purchase_return_items quantities unchanged', ((SELECT COUNT(*) FROM `purchase_return_items` WHERE `baseQuantity` <> `quantity` OR `unitFactor` <> 1) = 0);
INSERT INTO `_unit_migration_guard` (`what`, `ok`) SELECT 'sale_items quantities unchanged', ((SELECT COUNT(*) FROM `sale_items` WHERE `baseQuantity` <> `quantity` OR `unitFactor` <> 1) = 0);
INSERT INTO `_unit_migration_guard` (`what`, `ok`) SELECT 'sale_return_items quantities unchanged', ((SELECT COUNT(*) FROM `sale_return_items` WHERE `baseQuantity` <> `quantity` OR `unitFactor` <> 1) = 0);
INSERT INTO `_unit_migration_guard` (`what`, `ok`) SELECT 'stock_transfer_items quantities unchanged', ((SELECT COUNT(*) FROM `stock_transfer_items` WHERE `baseQuantity` <> `quantity` OR `unitFactor` <> 1) = 0);
INSERT INTO `_unit_migration_guard` (`what`, `ok`) SELECT 'stock_adjustment_items quantities unchanged', ((SELECT COUNT(*) FROM `stock_adjustment_items` WHERE `baseQuantity` <> `quantity` OR `unitFactor` <> 1) = 0);

DROP TABLE `_unit_migration_guard`;
