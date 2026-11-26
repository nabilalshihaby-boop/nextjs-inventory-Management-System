-- Product status (additive).
--
-- One NOT NULL column with DEFAULT true: every existing product becomes active, nothing else changes (no row is rewritten beyond the column
-- default, no data is dropped, no document or stock row is touched). An inactive product stays in every historical document and report, but
-- the server refuses it in new operational documents. Products with any history are deactivated instead of deleted (lib/product-removal.ts).

-- AlterTable
ALTER TABLE `products` ADD COLUMN `active` BOOLEAN NOT NULL DEFAULT true;
