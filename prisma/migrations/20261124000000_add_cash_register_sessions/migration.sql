-- AlterTable
ALTER TABLE `customer_payments` ADD COLUMN `registerSessionId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `cash_register_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(20) NOT NULL,
    `cashBankAccountId` VARCHAR(191) NOT NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `openAccountKey` VARCHAR(191) NULL,
    `openingCash` DECIMAL(14, 2) NOT NULL,
    `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `openedById` VARCHAR(191) NOT NULL,
    `openingNotes` TEXT NULL,
    `closedAt` DATETIME(3) NULL,
    `closedById` VARCHAR(191) NULL,
    `closingCash` DECIMAL(14, 2) NULL,
    `expectedCash` DECIMAL(14, 2) NULL,
    `difference` DECIMAL(14, 2) NULL,
    `closingNotes` TEXT NULL,

    UNIQUE INDEX `cash_register_sessions_number_key`(`number`),
    UNIQUE INDEX `cash_register_sessions_reference_key`(`reference`),
    UNIQUE INDEX `cash_register_sessions_openAccountKey_key`(`openAccountKey`),
    INDEX `cash_register_sessions_cashBankAccountId_status_idx`(`cashBankAccountId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `customer_payments_registerSessionId_idx` ON `customer_payments`(`registerSessionId`);

-- AddForeignKey
ALTER TABLE `cash_register_sessions` ADD CONSTRAINT `cash_register_sessions_cashBankAccountId_fkey` FOREIGN KEY (`cashBankAccountId`) REFERENCES `cash_bank_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_payments` ADD CONSTRAINT `customer_payments_registerSessionId_fkey` FOREIGN KEY (`registerSessionId`) REFERENCES `cash_register_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
