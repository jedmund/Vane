ALTER TABLE `users` ADD COLUMN `isAdmin` INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text REFERENCES users(id),
	`type` text NOT NULL,
	`name` text NOT NULL,
	`config` text NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `providers_user_id_idx` ON `providers` (`userId`);
--> statement-breakpoint
UPDATE `users` SET `isAdmin` = 1 WHERE `id` = 'legacy';
