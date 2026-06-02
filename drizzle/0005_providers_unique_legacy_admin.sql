-- Defensive insert of the synthetic 'legacy' user. 0003 normally creates
-- this row and 0004 promotes it to admin. If 0003 was skipped or rolled
-- back the 0004 UPDATE silently affected 0 rows, leaving the deployment
-- without an admin. INSERT OR IGNORE creates the row only when missing and
-- never overwrites existing data.
INSERT OR IGNORE INTO `users` (`id`, `sub`, `email`, `name`, `createdAt`, `isAdmin`)
VALUES ('legacy', NULL, NULL, 'Legacy User', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1);
--> statement-breakpoint
-- Belt-and-suspenders: re-apply the admin flag in case the row pre-existed
-- 0005 (the INSERT OR IGNORE above no-oped) and is somehow not admin yet.
-- Cheap and idempotent.
UPDATE `users` SET `isAdmin` = 1 WHERE `id` = 'legacy';
--> statement-breakpoint
-- Uniqueness on (userId, type, name) so a partial seed retry cannot insert
-- duplicate rows after a mid-loop crash. COALESCE collapses NULL userId to
-- the empty string so two instance providers (userId IS NULL) with the same
-- (type, name) collide too; SQLite's default NULL-distinct behavior in
-- UNIQUE indexes would otherwise allow duplicate instance rows. If an
-- existing duplicate is already in the table the CREATE fails loudly, which
-- is the correct response: the operator must reconcile before upgrade.
CREATE UNIQUE INDEX IF NOT EXISTS `providers_unique_idx`
  ON `providers` (COALESCE(`userId`, ''), `type`, `name`);
