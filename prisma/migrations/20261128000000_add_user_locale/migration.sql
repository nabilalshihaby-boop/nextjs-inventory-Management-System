-- AlterTable
ALTER TABLE `user_preferences` MODIFY `theme` JSON NULL, ADD COLUMN `locale` VARCHAR(5) NULL;
