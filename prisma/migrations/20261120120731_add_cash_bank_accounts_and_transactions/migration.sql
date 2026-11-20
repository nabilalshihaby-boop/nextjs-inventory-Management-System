-- CreateTable
CREATE TABLE `cash_bank_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `type` ENUM('CASH', 'BANK') NOT NULL,
    `reference` VARCHAR(64) NULL,
    `bankName` VARCHAR(120) NULL,
    `currencyId` VARCHAR(191) NOT NULL,
    `openingBalance` DECIMAL(14, 2) NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cash_bank_accounts_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cash_bank_transactions` (
    `id` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(20) NOT NULL,
    `transactionDate` DATE NOT NULL,
    `type` ENUM('DEPOSIT', 'WITHDRAWAL', 'TRANSFER') NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `destinationAccountId` VARCHAR(191) NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `paymentMethod` VARCHAR(32) NULL,
    `purpose` VARCHAR(64) NULL,
    `notes` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `cash_bank_transactions_number_key`(`number`),
    UNIQUE INDEX `cash_bank_transactions_reference_key`(`reference`),
    INDEX `cash_bank_transactions_accountId_idx`(`accountId`),
    INDEX `cash_bank_transactions_destinationAccountId_idx`(`destinationAccountId`),
    INDEX `cash_bank_transactions_transactionDate_idx`(`transactionDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `cash_bank_accounts` ADD CONSTRAINT `cash_bank_accounts_currencyId_fkey` FOREIGN KEY (`currencyId`) REFERENCES `currencies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_bank_transactions` ADD CONSTRAINT `cash_bank_transactions_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `cash_bank_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_bank_transactions` ADD CONSTRAINT `cash_bank_transactions_destinationAccountId_fkey` FOREIGN KEY (`destinationAccountId`) REFERENCES `cash_bank_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
