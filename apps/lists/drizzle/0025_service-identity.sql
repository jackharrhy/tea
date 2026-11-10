ALTER TABLE `users` ADD `auth_principal_type` text NOT NULL DEFAULT 'user';
--> statement-breakpoint
ALTER TABLE `users` ADD `auth_client_id` text;
