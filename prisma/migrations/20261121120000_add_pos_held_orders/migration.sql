-- CreateTable
CREATE TABLE `pos_held_orders` (
    `id` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(20) NOT NULL,
    `holdKey` VARCHAR(64) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `status` ENUM('HELD', 'CONSUMED', 'DISCARDED') NOT NULL DEFAULT 'HELD',
    `customerId` VARCHAR(191) NULL,
    `warehouseId` VARCHAR(191) NULL,
    `cashBankAccountId` VARCHAR(191) NULL,
    `paymentMethod` VARCHAR(32) NULL,
    `notes` TEXT NULL,
    `consumedSaleId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pos_held_orders_number_key`(`number`),
    UNIQUE INDEX `pos_held_orders_reference_key`(`reference`),
    UNIQUE INDEX `pos_held_orders_holdKey_key`(`holdKey`),
    UNIQUE INDEX `pos_held_orders_consumedSaleId_key`(`consumedSaleId`),
    INDEX `pos_held_orders_createdById_status_idx`(`createdById`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pos_held_order_items` (
    `id` VARCHAR(191) NOT NULL,
    `heldOrderId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `productCode` VARCHAR(64) NOT NULL,
    `productName` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,
    `unitPrice` DECIMAL(14, 2) NOT NULL,

    UNIQUE INDEX `pos_held_order_items_heldOrderId_productId_key`(`heldOrderId`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `pos_held_order_items` ADD CONSTRAINT `pos_held_order_items_heldOrderId_fkey` FOREIGN KEY (`heldOrderId`) REFERENCES `pos_held_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
