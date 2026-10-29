ALTER TABLE `users` RENAME COLUMN `fourm_id` TO `auth_subject`;
--> statement-breakpoint
DROP INDEX `users_fourm_id_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_auth_subject_unique` ON `users` (`auth_subject`);
--> statement-breakpoint
DELETE FROM `sessions`;
--> statement-breakpoint
DELETE FROM `cli_login_handoffs`;
--> statement-breakpoint
ALTER TABLE `cli_login_handoffs` ADD COLUMN `session_expires_at` integer NOT NULL DEFAULT 0;
