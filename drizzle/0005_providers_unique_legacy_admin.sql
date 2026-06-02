-- Defensive upsert of the synthetic 'legacy' user with isAdmin=1. The 0003
-- migration normally creates this row and 0004 promotes it. If 0003 was
-- skipped or rolled back the 0004 UPDATE silently affected 0 rows, leaving
-- the deployment without an admin. ON CONFLICT keeps existing rows untouched
-- (except for isAdmin) so this is safe to re-apply.
INSERT INTO `users` (`id`, `sub`, `email`, `name`, `createdAt`, `isAdmin`)
VALUES ('legacy', NULL, NULL, 'Legacy User', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
ON CONFLICT(`id`) DO UPDATE SET `isAdmin` = 1;
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
