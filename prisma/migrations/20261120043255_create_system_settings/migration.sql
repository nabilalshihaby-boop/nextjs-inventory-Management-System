-- CreateTable
CREATE TABLE `system_settings` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `defaultCurrency` VARCHAR(8) NOT NULL,
    `defaultEmail` VARCHAR(191) NULL,
    `currencyIconRight` BOOLEAN NOT NULL DEFAULT false,
    `companyLogo` VARCHAR(255) NULL,
    `companyName` VARCHAR(120) NOT NULL,
    `companyPhone` VARCHAR(32) NULL,
    `developedBy` VARCHAR(120) NULL,
    `footerText` VARCHAR(255) NULL,
    `country` CHAR(2) NOT NULL,
    `state` VARCHAR(120) NOT NULL,
    `city` VARCHAR(120) NULL,
    `postalCode` VARCHAR(20) NULL,
    `dateFormat` VARCHAR(16) NOT NULL,
    `address` VARCHAR(500) NULL,
    `showVersionInFooter` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
