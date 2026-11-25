-- Base Unit status (additive).
--
-- `product_units` is the existing master list of reusable units (Piece, Kilogram, Meter, Carton ...). Adding one NOT NULL column with
-- DEFAULT true marks every existing unit active, so nothing changes for existing products, conversions or documents. An inactive unit
-- stays visible wherever it is already used but can't be chosen for new product setup (enforced by the product actions).
-- No row is rewritten beyond the column default; no data is dropped.

-- AlterTable
ALTER TABLE `product_units` ADD COLUMN `active` BOOLEAN NOT NULL DEFAULT true;
