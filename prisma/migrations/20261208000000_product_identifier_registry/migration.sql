-- Product identifier registry: ONE unique namespace for every SKU (products.code) and every stored unit barcode
-- (product_unit_conversions.barcode). Purely additive: no existing column, row or foreign key is changed, and no sales, purchase,
-- stock, return, transfer or finance row is touched. products.code and the barcode column stay the canonical values.
--
-- SAFE DEPLOYMENT ORDER (see docs/product-identifier-registry-deployment.md):
--   1. npx tsx prisma/preflight-identifiers.ts   (read-only; exits non-zero and lists every blocking legacy collision)
--   2. fix the reported legacy data in the application (nothing is guessed or auto-resolved), repeat 1 until it passes
--   3. npx prisma migrate deploy
--   4. npx prisma generate
--
-- This file deliberately contains NO stored procedure, trigger, event, temporary object or intentionally raised error. The table is
-- created AND backfilled by ONE statement (CREATE TABLE ... SELECT): if two identifiers ever collided (only possible when step 1 was
-- skipped) the statement fails as a whole and the database engine removes the half-built table, so nothing is left behind.
-- Legacy rule: a Base Unit barcode equal to its OWN SKU (what older versions assigned automatically) becomes an ALIAS — the SKU row
-- points at that unit and there is no second row for it. Every other stored barcode gets a BARCODE row tied to its unit.

-- CreateTable (+ backfill: one SKU identifier per product, one BARCODE identifier per other stored barcode)
CREATE TABLE `product_identifiers` (
    `id` VARCHAR(191) NOT NULL,
    `valueKey` VARCHAR(64) NOT NULL,
    `kind` ENUM('SKU', 'BARCODE') NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `conversionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `product_identifiers_valueKey_key`(`valueKey`),
    UNIQUE INDEX `product_identifiers_conversionId_key`(`conversionId`),
    INDEX `product_identifiers_productId_idx`(`productId`),
    INDEX `product_identifiers_kind_idx`(`kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
SELECT `id`, `valueKey`, `kind`, `productId`, `conversionId` FROM (
    SELECT CONCAT('pid', REPLACE(UUID(), '-', '')) AS `id`, UPPER(p.`code`) AS `valueKey`, 'SKU' AS `kind`, p.`id` AS `productId`,
           (SELECT c.`id` FROM `product_unit_conversions` c WHERE c.`productId` = p.`id` AND c.`isBase` = 1 AND c.`barcode` IS NOT NULL AND UPPER(c.`barcode`) = UPPER(p.`code`) LIMIT 1) AS `conversionId`
    FROM `products` p
    UNION ALL
    SELECT CONCAT('pid', REPLACE(UUID(), '-', '')), UPPER(c.`barcode`), 'BARCODE', c.`productId`, c.`id`
    FROM `product_unit_conversions` c JOIN `products` p ON p.`id` = c.`productId`
    WHERE c.`barcode` IS NOT NULL AND NOT (c.`isBase` = 1 AND UPPER(c.`barcode`) = UPPER(p.`code`))
) AS `backfill`;

-- AddForeignKey
ALTER TABLE `product_identifiers` ADD CONSTRAINT `product_identifiers_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_identifiers` ADD CONSTRAINT `product_identifiers_conversionId_fkey` FOREIGN KEY (`conversionId`) REFERENCES `product_unit_conversions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
