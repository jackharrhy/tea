PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_campaigns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`list_id` integer,
	`subject` text NOT NULL,
	`body_markdown` text NOT NULL,
	`template_slug` text DEFAULT 'newsletter' NOT NULL,
	`from_address` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`last_error` text,
	`sent_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_campaigns`("id", "list_id", "subject", "body_markdown", "template_slug", "from_address", "status", "last_error", "sent_at", "created_at") SELECT "id", "list_id", "subject", "body_markdown", "template_slug", "from_address", "status", "last_error", "sent_at", "created_at" FROM `campaigns`;--> statement-breakpoint
DROP TABLE `campaigns`;--> statement-breakpoint
ALTER TABLE `__new_campaigns` RENAME TO `campaigns`;--> statement-breakpoint
PRAGMA foreign_keys=ON;