-- Product Unit barcodes. A barcode identifies ONE product unit (a row of product_unit_conversions) and is unique
-- across every product. This migration only ADDS a nullable column; no product, unit, stock, document or financial
-- row is changed except that valid Base Unit barcodes are initialised from the Product Code (see below).

-- AlterTable
ALTER TABLE `product_unit_conversions` ADD COLUMN `barcode` VARCHAR(20) NULL;

-- CreateIndex (global uniqueness; case-insensitive like the rest of the schema; several NULLs are allowed)
CREATE UNIQUE INDEX `product_unit_conversions_barcode_key` ON `product_unit_conversions`(`barcode`);

-- Backfill: the Base Unit of every product takes the Product Code as its barcode, ONLY when the code is a valid
-- Code 128 value (printable ASCII, 1–20 characters, no surrounding spaces). Product codes are already unique,
-- and only base rows are touched, so the unique index cannot be violated. Nothing else is written:
-- explicit barcodes do not exist yet, so none can be overwritten; invalid or over-long codes stay NULL
-- (the unit then needs a barcode set before it can be printed or scanned).
UPDATE `product_unit_conversions` c
JOIN `products` p ON p.`id` = c.`productId`
SET c.`barcode` = p.`code`
WHERE c.`isBase` = 1
  AND c.`barcode` IS NULL
  AND CHAR_LENGTH(p.`code`) BETWEEN 1 AND 20
  AND p.`code` REGEXP '^[ -~]+$'
  AND p.`code` = TRIM(p.`code`);

-- Defensive format check (the app validates too): NULL, or 1–20 printable ASCII characters without edge spaces.
ALTER TABLE `product_unit_conversions`
  ADD CONSTRAINT `chk_product_unit_barcode` CHECK (`barcode` IS NULL OR (`barcode` REGEXP '^[ -~]{1,20}$' AND `barcode` = TRIM(`barcode`)));
