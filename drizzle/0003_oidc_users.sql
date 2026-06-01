CREATE TABLE IF NOT EXISTS `users` (
	`id` text PRIMARY KEY NOT NULL,
	`sub` text,
	`email` text,
	`name` text,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_sub_idx` ON `users` (`sub`);
--> statement-breakpoint
ALTER TABLE `chats` ADD COLUMN `userId` text REFERENCES users(id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `chats_user_id_idx` ON `chats` (`userId`);
--> statement-breakpoint
INSERT OR IGNORE INTO `users` (`id`, `sub`, `email`, `name`, `createdAt`) VALUES ('legacy', NULL, NULL, 'Legacy User', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
--> statement-breakpoint
UPDATE `chats` SET `userId` = 'legacy' WHERE `userId` IS NULL;
