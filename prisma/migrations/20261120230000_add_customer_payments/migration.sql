-- AlterTable
ALTER TABLE `cash_bank_transactions` ADD COLUMN `customerPaymentId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `customer_payments` (
    `id` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(20) NOT NULL,
    `paymentDate` DATE NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `cashBankAccountId` VARCHAR(191) NOT NULL,
    `currencyId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `paymentMethod` VARCHAR(32) NOT NULL,
    `externalReference` VARCHAR(64) NULL,
    `notes` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `customer_payments_number_key`(`number`),
    UNIQUE INDEX `customer_payments_reference_key`(`reference`),
    INDEX `customer_payments_customerId_idx`(`customerId`),
    INDEX `customer_payments_cashBankAccountId_idx`(`cashBankAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_payment_allocations` (
    `id` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `saleId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,

    INDEX `customer_payment_allocations_saleId_idx`(`saleId`),
    UNIQUE INDEX `customer_payment_allocations_paymentId_saleId_key`(`paymentId`, `saleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `cash_bank_transactions_customerPaymentId_key` ON `cash_bank_transactions`(`customerPaymentId`);

-- AddForeignKey
ALTER TABLE `cash_bank_transactions` ADD CONSTRAINT `cash_bank_transactions_customerPaymentId_fkey` FOREIGN KEY (`customerPaymentId`) REFERENCES `customer_payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_payments` ADD CONSTRAINT `customer_payments_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_payments` ADD CONSTRAINT `customer_payments_cashBankAccountId_fkey` FOREIGN KEY (`cashBankAccountId`) REFERENCES `cash_bank_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_payments` ADD CONSTRAINT `customer_payments_currencyId_fkey` FOREIGN KEY (`currencyId`) REFERENCES `currencies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_payment_allocations` ADD CONSTRAINT `customer_payment_allocations_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `customer_payments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_payment_allocations` ADD CONSTRAINT `customer_payment_allocations_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `sales`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

