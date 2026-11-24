-- System Settings "Default Warehouse": one nullable column + FK on system_settings. Additive only; no existing row is changed.

-- AlterTable
ALTER TABLE `system_settings` ADD COLUMN `defaultWarehouseId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `system_settings` ADD CONSTRAINT `system_settings_defaultWarehouseId_fkey` FOREIGN KEY (`defaultWarehouseId`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
