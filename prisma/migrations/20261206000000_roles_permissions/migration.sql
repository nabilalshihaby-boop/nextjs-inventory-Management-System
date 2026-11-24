-- Roles & Permissions: operational staff roles, their permissions, per-user warehouse scope and an immutable audit trail.
-- Additive only: one nullable column on users (accessRoleId) and four new tables. No existing row is changed.

-- AlterTable
ALTER TABLE `users` ADD COLUMN `accessRoleId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `access_roles` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `normalizedName` VARCHAR(80) NOT NULL,
    `description` VARCHAR(255) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `templateKey` VARCHAR(32) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `access_roles_normalizedName_key`(`normalizedName`),
    UNIQUE INDEX `access_roles_templateKey_key`(`templateKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `access_role_permissions` (
    `id` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,
    `permissionKey` VARCHAR(64) NOT NULL,

    UNIQUE INDEX `access_role_permissions_roleId_permissionKey_key`(`roleId`, `permissionKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_warehouse_scopes` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_warehouse_scopes_warehouseId_idx`(`warehouseId`),
    UNIQUE INDEX `user_warehouse_scopes_userId_warehouseId_key`(`userId`, `warehouseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_events` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(48) NOT NULL,
    `targetType` VARCHAR(32) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_events_targetType_targetId_idx`(`targetType`, `targetId`),
    INDEX `audit_events_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `users_accessRoleId_idx` ON `users`(`accessRoleId`);

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_accessRoleId_fkey` FOREIGN KEY (`accessRoleId`) REFERENCES `access_roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `access_role_permissions` ADD CONSTRAINT `access_role_permissions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `access_roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_warehouse_scopes` ADD CONSTRAINT `user_warehouse_scopes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_warehouse_scopes` ADD CONSTRAINT `user_warehouse_scopes_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

