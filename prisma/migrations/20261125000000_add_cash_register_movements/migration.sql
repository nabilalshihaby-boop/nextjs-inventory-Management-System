-- CreateTable
CREATE TABLE `cash_register_movements` (
    `id` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(20) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `type` ENUM('CASH_IN', 'CASH_OUT') NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `fromAccountId` VARCHAR(191) NOT NULL,
    `toAccountId` VARCHAR(191) NOT NULL,
    `transactionId` VARCHAR(191) NOT NULL,
    `notes` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdById` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `cash_register_movements_number_key`(`number`),
    UNIQUE INDEX `cash_register_movements_reference_key`(`reference`),
    UNIQUE INDEX `cash_register_movements_transactionId_key`(`transactionId`),
    INDEX `cash_register_movements_sessionId_idx`(`sessionId`),
    INDEX `cash_register_movements_fromAccountId_fkey`(`fromAccountId`),
    INDEX `cash_register_movements_toAccountId_fkey`(`toAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `cash_register_movements` ADD CONSTRAINT `cash_register_movements_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `cash_register_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_register_movements` ADD CONSTRAINT `cash_register_movements_fromAccountId_fkey` FOREIGN KEY (`fromAccountId`) REFERENCES `cash_bank_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_register_movements` ADD CONSTRAINT `cash_register_movements_toAccountId_fkey` FOREIGN KEY (`toAccountId`) REFERENCES `cash_bank_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_register_movements` ADD CONSTRAINT `cash_register_movements_transactionId_fkey` FOREIGN KEY (`transactionId`) REFERENCES `cash_bank_transactions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
