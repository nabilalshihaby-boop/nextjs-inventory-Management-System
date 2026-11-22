-- Owner-set Opening Inventory Cost Baseline (Profit & Loss setup). A dedicated, immutable valuation record per product:
-- it is NOT a purchase or stock movement and changes no existing row. Additive only (one new table).

-- CreateTable
CREATE TABLE `inventory_cost_baselines` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `currencyId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,
    `unitCost` DECIMAL(14, 2) NOT NULL,
    `totalValue` DECIMAL(14, 2) NOT NULL,
    `effectiveAt` DATETIME(3) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `inventory_cost_baselines_productId_key`(`productId`),
    INDEX `inventory_cost_baselines_currencyId_idx`(`currencyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `inventory_cost_baselines` ADD CONSTRAINT `inventory_cost_baselines_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_cost_baselines` ADD CONSTRAINT `inventory_cost_baselines_currencyId_fkey` FOREIGN KEY (`currencyId`) REFERENCES `currencies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

