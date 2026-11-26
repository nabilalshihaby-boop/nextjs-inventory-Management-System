-- Immutable financial snapshot of a held POS order line, captured on the server when the order is held: the unit's name, its factor (base
-- units in ONE unit), the line's base quantity, and the tax type and rate. Together with the existing `unitPrice` they are everything the
-- sale calculation needs. Purely additive: five NULLable columns. NULL = a line held before this migration ("legacy"); nothing is
-- backfilled, because the values in use at hold time were never recorded. The CHECK (MariaDB >= 10.2.1, MySQL >= 8.0.16) keeps a snapshot
-- all-or-nothing, tied to a unit id, with a non-blank unit name, a positive factor and base quantity that agree with the quantity, a known
-- tax type, a tax rate of 0-100 and a non-negative price. No data is changed or dropped.

-- Revision of a held order (optimistic concurrency): the server increments it on every change, and a hold update, discard or checkout that
-- carries an older one is refused. Existing orders start at 1.

-- AlterTable
ALTER TABLE `pos_held_orders`
    ADD COLUMN `revision` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `pos_held_order_items`
    ADD COLUMN `unitName` VARCHAR(64) NULL,
    ADD COLUMN `unitFactor` DECIMAL(16, 6) NULL,
    ADD COLUMN `baseQuantity` DECIMAL(14, 3) NULL,
    ADD COLUMN `taxType` ENUM('EXCLUSIVE', 'INCLUSIVE') NULL,
    ADD COLUMN `taxRate` DECIMAL(5, 2) NULL;

-- Snapshot is all-or-nothing and valid
ALTER TABLE `pos_held_order_items`
    ADD CONSTRAINT `pos_held_order_items_unit_snapshot_chk` CHECK (
        (`unitName` IS NULL AND `unitFactor` IS NULL AND `baseQuantity` IS NULL AND `taxType` IS NULL AND `taxRate` IS NULL)
        OR (
            `unitId` IS NOT NULL
            AND `unitName` IS NOT NULL AND `unitName` REGEXP '[^[:space:]]'
            AND `unitFactor` IS NOT NULL AND `unitFactor` > 0
            AND `baseQuantity` IS NOT NULL AND `baseQuantity` > 0 AND `baseQuantity` = `quantity` * `unitFactor`
            AND `taxType` IS NOT NULL AND `taxType` IN ('EXCLUSIVE', 'INCLUSIVE')
            AND `taxRate` IS NOT NULL AND `taxRate` >= 0 AND `taxRate` <= 100
            AND `unitPrice` >= 0
        )
    );
