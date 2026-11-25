-- Product Families and Variant Attributes (additive).
--
-- Creates `product_families` and adds five NULLABLE columns to `products` (familyId, variantValue1..3, variantKey) plus a unique index
-- on (familyId, variantKey). Nothing is backfilled and no existing row is read or changed: every legacy product keeps familyId = NULL
-- and stays a standalone product. MySQL / MariaDB unique indexes accept many NULL pairs, so standalone products never collide.
-- Each family also carries a stable `handle` (Shopify-compatible group identity) with a unique normalized `handleKey`; no legacy product is given one.
-- Both handle columns are also protected by CHECK constraints (enforced by MariaDB >= 10.2.1 and MySQL >= 8.0.16): a value must contain at least one
-- non-whitespace character, so '' and whitespace-only values are rejected by the database itself, not just by the application.
-- No data is dropped; the foreign key is RESTRICT (a family with members can't be deleted).

-- CreateTable
CREATE TABLE `product_families` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `handle` VARCHAR(255) NOT NULL,
    `handleKey` VARCHAR(255) NOT NULL,
    `dimension1` VARCHAR(40) NULL,
    `dimension2` VARCHAR(40) NULL,
    `dimension3` VARCHAR(40) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `product_families_name_key`(`name`),
    UNIQUE INDEX `product_families_handleKey_key`(`handleKey`),
    PRIMARY KEY (`id`),
    CONSTRAINT `product_families_handle_not_blank` CHECK (`handle` REGEXP '[^[:space:]]'),
    CONSTRAINT `product_families_handleKey_not_blank` CHECK (`handleKey` REGEXP '[^[:space:]]')
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `products` ADD COLUMN `familyId` VARCHAR(191) NULL,
    ADD COLUMN `variantKey` VARCHAR(191) NULL,
    ADD COLUMN `variantValue1` VARCHAR(60) NULL,
    ADD COLUMN `variantValue2` VARCHAR(60) NULL,
    ADD COLUMN `variantValue3` VARCHAR(60) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `products_family_variant_key` ON `products`(`familyId`, `variantKey`);

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_familyId_fkey` FOREIGN KEY (`familyId`) REFERENCES `product_families`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
