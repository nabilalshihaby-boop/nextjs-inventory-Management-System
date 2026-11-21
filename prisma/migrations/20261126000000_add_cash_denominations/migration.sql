-- CreateTable
CREATE TABLE `currency_denominations` (
    `id` VARCHAR(191) NOT NULL,
    `currencyId` VARCHAR(191) NOT NULL,
    `value` DECIMAL(14, 2) NOT NULL,
    `label` VARCHAR(60) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `currency_denominations_currencyId_value_key`(`currencyId`, `value`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cash_register_counts` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `denominationId` VARCHAR(191) NULL,
    `value` DECIMAL(14, 2) NOT NULL,
    `label` VARCHAR(60) NULL,
    `count` INTEGER NOT NULL,
    `lineTotal` DECIMAL(14, 2) NOT NULL,

    INDEX `cash_register_counts_sessionId_idx`(`sessionId`),
    INDEX `cash_register_counts_denominationId_idx`(`denominationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `currency_denominations` ADD CONSTRAINT `currency_denominations_currencyId_fkey` FOREIGN KEY (`currencyId`) REFERENCES `currencies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_register_counts` ADD CONSTRAINT `cash_register_counts_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `cash_register_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
