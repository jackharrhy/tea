CREATE TABLE `campaign_sends` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` integer NOT NULL,
	`subscriber_id` integer NOT NULL,
	`ses_message_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`sent_at` text,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`list_id` integer NOT NULL,
	`subject` text NOT NULL,
	`body_markdown` text NOT NULL,
	`template_slug` text DEFAULT 'newsletter' NOT NULL,
	`from_address` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`sent_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inbound_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` text NOT NULL,
	`timestamp` text NOT NULL,
	`source` text NOT NULL,
	`from_addrs` text NOT NULL,
	`to_addrs` text NOT NULL,
	`subject` text NOT NULL,
	`spam_verdict` text,
	`virus_verdict` text,
	`spf_verdict` text,
	`dkim_verdict` text,
	`dmarc_verdict` text,
	`s3_key` text,
	`campaign_id` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_messages_message_id_unique` ON `inbound_messages` (`message_id`);--> statement-breakpoint
CREATE TABLE `lists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lists_slug_unique` ON `lists` (`slug`);--> statement-breakpoint
CREATE TABLE `replies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`inbound_message_id` integer NOT NULL,
	`from_addr` text NOT NULL,
	`to_addr` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`ses_message_id` text,
	`in_reply_to` text,
	`sent_at` text NOT NULL,
	FOREIGN KEY (`inbound_message_id`) REFERENCES `inbound_messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `subscriber_lists` (
	`subscriber_id` integer NOT NULL,
	`list_id` integer NOT NULL,
	`status` text DEFAULT 'unconfirmed' NOT NULL,
	`subscribed_at` text NOT NULL,
	FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `subscribers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`status` text DEFAULT 'active' NOT NULL,
	`unsubscribe_token` text NOT NULL,
	`created_at` text NOT NULL,
	`confirmed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscribers_email_unique` ON `subscribers` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscribers_unsubscribe_token_unique` ON `subscribers` (`unsubscribe_token`);