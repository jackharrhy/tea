CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`meta` text,
	`subscriber_id` integer,
	`campaign_id` integer,
	`inbound_message_id` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inbound_message_id`) REFERENCES `inbound_messages`(`id`) ON UPDATE no action ON DELETE no action
);
