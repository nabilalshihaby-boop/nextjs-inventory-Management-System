-- CreateTable
CREATE TABLE `pos_held_order_tenders` (
    `id` VARCHAR(191) NOT NULL,
    `heldOrderId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,
    `paymentMethod` VARCHAR(32) NULL,
    `cashBankAccountId` VARCHAR(191) NULL,
    `amount` DECIMAL(14, 2) NULL,

    INDEX `pos_held_order_tenders_heldOrderId_idx`(`heldOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `pos_held_order_tenders` ADD CONSTRAINT `pos_held_order_tenders_heldOrderId_fkey` FOREIGN KEY (`heldOrderId`) REFERENCES `pos_held_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
