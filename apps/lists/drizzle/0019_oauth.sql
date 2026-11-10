CREATE TABLE `oauth_clients` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `client_id` text NOT NULL UNIQUE,
  `client_name` text NOT NULL,
  `redirect_uris` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_authorization_codes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `code_hash` text NOT NULL UNIQUE,
  `client_id` text NOT NULL REFERENCES `oauth_clients`(`client_id`) ON DELETE CASCADE,
  `user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `redirect_uri` text NOT NULL,
  `scopes` text NOT NULL,
  `code_challenge` text NOT NULL,
  `expires_at` text NOT NULL,
  `used_at` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauth_codes_hash_idx` ON `oauth_authorization_codes` (`code_hash`);
--> statement-breakpoint
CREATE TABLE `oauth_refresh_tokens` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `token_hash` text NOT NULL UNIQUE,
  `client_id` text NOT NULL REFERENCES `oauth_clients`(`client_id`) ON DELETE CASCADE,
  `user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `scopes` text NOT NULL,
  `expires_at` text NOT NULL,
  `revoked_at` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauth_refresh_hash_idx` ON `oauth_refresh_tokens` (`token_hash`);
