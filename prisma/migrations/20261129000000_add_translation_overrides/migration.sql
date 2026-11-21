-- Owner-managed Arabic text overrides (English stays in code; default Arabic stays in ar.ts).
CREATE TABLE `translation_overrides` (
    `id` VARCHAR(191) NOT NULL,
    `locale` VARCHAR(5) NOT NULL,
    `key` VARCHAR(120) NOT NULL,
    `text` VARCHAR(1000) NOT NULL,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `translation_overrides_updatedById_idx`(`updatedById`),
    UNIQUE INDEX `translation_overrides_locale_key_key`(`locale`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `translation_overrides` ADD CONSTRAINT `translation_overrides_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
