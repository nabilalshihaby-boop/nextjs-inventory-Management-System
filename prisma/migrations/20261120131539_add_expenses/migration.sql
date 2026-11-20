-- AlterTable
ALTER TABLE `cash_bank_transactions` ADD COLUMN `expenseId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `expenses` (
    `id` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(20) NOT NULL,
    `expenseDate` DATE NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `cashBankAccountId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `details` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `deletedAt` DATETIME(3) NULL,
    `activeTransactionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `expenses_number_key`(`number`),
    UNIQUE INDEX `expenses_reference_key`(`reference`),
    UNIQUE INDEX `expenses_activeTransactionId_key`(`activeTransactionId`),
    INDEX `expenses_warehouseId_idx`(`warehouseId`),
    INDEX `expenses_categoryId_idx`(`categoryId`),
    INDEX `expenses_cashBankAccountId_idx`(`cashBankAccountId`),
    INDEX `expenses_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `cash_bank_transactions_expenseId_idx` ON `cash_bank_transactions`(`expenseId`);

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `expense_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_cashBankAccountId_fkey` FOREIGN KEY (`cashBankAccountId`) REFERENCES `cash_bank_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_activeTransactionId_fkey` FOREIGN KEY (`activeTransactionId`) REFERENCES `cash_bank_transactions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_bank_transactions` ADD CONSTRAINT `cash_bank_transactions_expenseId_fkey` FOREIGN KEY (`expenseId`) REFERENCES `expenses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
