-- Persistent Shopify-ready handles for standalone products, a shared handle namespace with Product Variant Groups, and HS Code.
--
-- Purely additive: two NULLABLE columns on `products`, one on `product_families` (the group's default HS Code) and one new table. No existing column, row or foreign key is changed, and no
-- sales, purchase, stock, return, transfer or finance row is touched. Existing family handles are copied into the registry EXACTLY
-- (their normalized `handleKey`, already unique). Existing standalone products keep `handle` = NULL here; they are given handles by the
-- separate, reviewable script prisma/backfill-product-handles.ts (dry run by default).
--
-- SAFE DEPLOYMENT ORDER (see docs/product-handles-deployment.md):
--   1. stop the application, then put the new code in place
--   2. npx tsx prisma/preflight-handles.ts        (read-only; exits non-zero if anything would block)
--   3. back up the database and verify the backup
--   4. npx prisma migrate deploy
--   5. npx prisma generate
--   6. npx tsx prisma/backfill-product-handles.ts            (dry run: review)
--      npx tsx prisma/backfill-product-handles.ts --apply
--   7. restart the application and verify

-- AlterTable
ALTER TABLE `products` ADD COLUMN `handle` VARCHAR(255) NULL,
    ADD COLUMN `hsCode` VARCHAR(10) NULL;

-- AlterTable
ALTER TABLE `product_families` ADD COLUMN `hsCode` VARCHAR(10) NULL;

-- CreateTable (+ the existing family handles, in one statement: it succeeds or leaves nothing behind)
CREATE TABLE `product_handles` (
    `id` VARCHAR(191) NOT NULL,
    `handleKey` VARCHAR(255) NOT NULL,
    `productId` VARCHAR(191) NULL,
    `familyId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `product_handles_handleKey_key`(`handleKey`),
    UNIQUE INDEX `product_handles_productId_key`(`productId`),
    UNIQUE INDEX `product_handles_familyId_key`(`familyId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `product_handles_one_owner` CHECK ((`productId` IS NULL) <> (`familyId` IS NULL)),
    CONSTRAINT `product_handles_key_not_blank` CHECK (`handleKey` REGEXP '[^[:space:]]')
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
SELECT CONCAT('ph', REPLACE(UUID(), '-', '')) AS `id`, f.`handleKey` AS `handleKey`, NULL AS `productId`, f.`id` AS `familyId`
FROM `product_families` f;

-- AddForeignKey
ALTER TABLE `product_handles` ADD CONSTRAINT `product_handles_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `product_handles` ADD CONSTRAINT `product_handles_familyId_fkey` FOREIGN KEY (`familyId`) REFERENCES `product_families`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
