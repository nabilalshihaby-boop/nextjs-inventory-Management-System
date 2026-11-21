-- AlterTable
ALTER TABLE `system_settings` ADD COLUMN `posWalkInCustomerId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `system_settings` ADD CONSTRAINT `system_settings_posWalkInCustomerId_fkey` FOREIGN KEY (`posWalkInCustomerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
