-- AlterTable
ALTER TABLE `cash_bank_transactions` ADD COLUMN `supplierPaymentId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `supplier_payments` (
    `id` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(20) NOT NULL,
    `paymentDate` DATE NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `cashBankAccountId` VARCHAR(191) NOT NULL,
    `currencyId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `paymentMethod` VARCHAR(32) NOT NULL,
    `externalReference` VARCHAR(64) NULL,
    `notes` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `supplier_payments_number_key`(`number`),
    UNIQUE INDEX `supplier_payments_reference_key`(`reference`),
    INDEX `supplier_payments_supplierId_idx`(`supplierId`),
    INDEX `supplier_payments_cashBankAccountId_idx`(`cashBankAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supplier_payment_allocations` (
    `id` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `purchaseId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,

    INDEX `supplier_payment_allocations_purchaseId_idx`(`purchaseId`),
    UNIQUE INDEX `supplier_payment_allocations_paymentId_purchaseId_key`(`paymentId`, `purchaseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `cash_bank_transactions_supplierPaymentId_key` ON `cash_bank_transactions`(`supplierPaymentId`);

-- AddForeignKey
ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payments_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payments_cashBankAccountId_fkey` FOREIGN KEY (`cashBankAccountId`) REFERENCES `cash_bank_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payments_currencyId_fkey` FOREIGN KEY (`currencyId`) REFERENCES `currencies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_payment_allocations` ADD CONSTRAINT `supplier_payment_allocations_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `supplier_payments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_payment_allocations` ADD CONSTRAINT `supplier_payment_allocations_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `purchases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_bank_transactions` ADD CONSTRAINT `cash_bank_transactions_supplierPaymentId_fkey` FOREIGN KEY (`supplierPaymentId`) REFERENCES `supplier_payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

