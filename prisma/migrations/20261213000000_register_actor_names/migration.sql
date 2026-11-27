-- Additive: immutable actor-name snapshots for register sessions and their cash movements.
-- No existing column is changed. The backfill copies the name only where the user can still be resolved;
-- anything else stays NULL (the report shows "Former user").
ALTER TABLE `cash_register_sessions`
    ADD COLUMN `openedByName` VARCHAR(400) NULL,
    ADD COLUMN `closedByName` VARCHAR(400) NULL;

ALTER TABLE `cash_register_movements`
    ADD COLUMN `createdByName` VARCHAR(400) NULL;

UPDATE `cash_register_sessions` s
    INNER JOIN `users` u ON u.`id` = s.`openedById`
    SET s.`openedByName` = NULLIF(TRIM(CONCAT(u.`firstName`, ' ', u.`lastName`)), '')
    WHERE s.`openedByName` IS NULL;

UPDATE `cash_register_sessions` s
    INNER JOIN `users` u ON u.`id` = s.`closedById`
    SET s.`closedByName` = NULLIF(TRIM(CONCAT(u.`firstName`, ' ', u.`lastName`)), '')
    WHERE s.`closedByName` IS NULL;

UPDATE `cash_register_movements` m
    INNER JOIN `users` u ON u.`id` = m.`createdById`
    SET m.`createdByName` = NULLIF(TRIM(CONCAT(u.`firstName`, ' ', u.`lastName`)), '')
    WHERE m.`createdByName` IS NULL;
