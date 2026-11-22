-- A POS order (and a held order) may now contain several lines of the SAME product when their units differ
-- (e.g. Water x 1 Box and Water x 2 Piece). The line identity becomes product + unit instead of product alone.
-- Only indexes change; no row is read or written. The new (wider) unique index is created BEFORE the old one is
-- dropped, because the foreign key on the first column needs an index at every moment. Existing rows can't violate
-- the wider key (they were unique on the narrower one); legacy lines have a NULL unit, which MySQL never treats as equal.

-- CreateIndex
CREATE UNIQUE INDEX `sale_items_saleId_productId_unitId_key` ON `sale_items`(`saleId`, `productId`, `unitId`);
-- DropIndex
DROP INDEX `sale_items_saleId_productId_key` ON `sale_items`;

-- CreateIndex
CREATE UNIQUE INDEX `pos_held_order_items_heldOrderId_productId_unitId_key` ON `pos_held_order_items`(`heldOrderId`, `productId`, `unitId`);
-- DropIndex
DROP INDEX `pos_held_order_items_heldOrderId_productId_key` ON `pos_held_order_items`;
