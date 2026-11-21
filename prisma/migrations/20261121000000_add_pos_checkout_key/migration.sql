-- AlterTable
ALTER TABLE `sales` ADD COLUMN `posCheckoutKey` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `sales_posCheckoutKey_key` ON `sales`(`posCheckoutKey`);
