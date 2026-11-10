CREATE TABLE `api_tokens` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `token_hash` text NOT NULL UNIQUE,
  `token_prefix` text NOT NULL,
  `scopes` text NOT NULL,
  `expires_at` text,
  `last_used_at` text,
  `revoked_at` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `api_tokens_user_idx` ON `api_tokens` (`user_id`);
--> statement-breakpoint
CREATE INDEX `api_tokens_hash_idx` ON `api_tokens` (`token_hash`);
