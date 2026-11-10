ALTER TABLE `api_tokens` ADD `audience` text;
--> statement-breakpoint
ALTER TABLE `oauth_authorization_codes` ADD `audience` text;
--> statement-breakpoint
ALTER TABLE `oauth_refresh_tokens` ADD `audience` text;
--> statement-breakpoint
ALTER TABLE `oauth_clients` ADD `scopes` text NOT NULL DEFAULT '["lists:read","subscribers:read","subscribers:write","campaigns:read","campaigns:write","campaigns:send","templates:read","templates:write","deliverability:read","dmarc:read"]';
