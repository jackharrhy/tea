DROP TABLE IF EXISTS `events`;--> statement-breakpoint
DROP TABLE IF EXISTS `replies`;--> statement-breakpoint
DROP TABLE IF EXISTS `inbound_messages`;--> statement-breakpoint
DROP TABLE IF EXISTS `campaign_sends`;--> statement-breakpoint
DROP TABLE IF EXISTS `campaigns`;--> statement-breakpoint

CREATE TABLE `campaigns` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `subject` text NOT NULL,
  `body_markdown` text NOT NULL,
  `template_slug` text NOT NULL DEFAULT 'newsletter',
  `from_address` text NOT NULL,
  `audience_type` text NOT NULL,
  `audience_id` integer,
  `audience_data` text,
  `status` text NOT NULL DEFAULT 'draft',
  `last_error` text,
  `sent_at` text,
  `created_at` text NOT NULL
);--> statement-breakpoint

CREATE TABLE `campaign_sends` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `campaign_id` integer NOT NULL REFERENCES `campaigns`(`id`),
  `subscriber_id` integer NOT NULL REFERENCES `subscribers`(`id`),
  `ses_message_id` text,
  `rfc822_message_id` text,
  `status` text NOT NULL DEFAULT 'pending',
  `sent_at` text
);--> statement-breakpoint

CREATE TABLE `messages` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `thread_id` integer NOT NULL,
  `parent_id` integer,
  `direction` text NOT NULL,
  `rfc822_message_id` text,
  `in_reply_to` text,
  `from_addr` text NOT NULL,
  `to_addr` text NOT NULL,
  `subject` text NOT NULL,
  `body_text` text,
  `body_html` text,
  `ses_message_id` text,
  `s3_key` text,
  `spam_verdict` text,
  `virus_verdict` text,
  `spf_verdict` text,
  `dkim_verdict` text,
  `dmarc_verdict` text,
  `campaign_id` integer REFERENCES `campaigns`(`id`),
  `read_at` text,
  `sent_at` text,
  `created_at` text NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX `messages_ses_message_id_unique` ON `messages` (`ses_message_id`);--> statement-breakpoint

CREATE TABLE `events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `type` text NOT NULL,
  `detail` text NOT NULL DEFAULT '',
  `meta` text,
  `user_id` integer REFERENCES `users`(`id`),
  `subscriber_id` integer REFERENCES `subscribers`(`id`),
  `campaign_id` integer REFERENCES `campaigns`(`id`),
  `message_id` integer REFERENCES `messages`(`id`),
  `created_at` text NOT NULL
);
