-- AlterTable
ALTER TABLE `system_settings` DROP COLUMN `defaultCurrency`,
    ADD COLUMN `defaultCurrencyId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `currencies` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `code` CHAR(3) NOT NULL,
    `symbol` VARCHAR(10) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `currencies_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `system_settings` ADD CONSTRAINT `system_settings_defaultCurrencyId_fkey` FOREIGN KEY (`defaultCurrencyId`) REFERENCES `currencies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

