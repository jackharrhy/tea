ALTER TABLE `campaign_sends` ADD `idempotency_key` text;--> statement-breakpoint
ALTER TABLE `campaign_sends` ADD `attempt_count` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `campaign_sends` ADD `next_attempt_at` text;--> statement-breakpoint
ALTER TABLE `campaign_sends` ADD `last_attempt_at` text;--> statement-breakpoint
ALTER TABLE `campaign_sends` ADD `accepted_at` text;--> statement-breakpoint
ALTER TABLE `campaign_sends` ADD `delivered_at` text;--> statement-breakpoint
ALTER TABLE `campaign_sends` ADD `last_error` text;--> statement-breakpoint
ALTER TABLE `campaign_sends` ADD `diagnostic_code` text;--> statement-breakpoint
ALTER TABLE `campaign_sends` ADD `bounce_type` text;--> statement-breakpoint
ALTER TABLE `campaign_sends` ADD `complaint_type` text;--> statement-breakpoint
ALTER TABLE `campaign_sends` ADD `updated_at` text NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';--> statement-breakpoint
UPDATE `campaign_sends` SET `status` = 'accepted', `accepted_at` = `sent_at`, `updated_at` = COALESCE(`sent_at`, CURRENT_TIMESTAMP) WHERE `status` = 'sent';--> statement-breakpoint
UPDATE `campaign_sends` SET `idempotency_key` = 'legacy:' || `id` WHERE `idempotency_key` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_sends_idempotency_unique` ON `campaign_sends` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `campaign_sends_campaign_subscriber_idx` ON `campaign_sends` (`campaign_id`, `subscriber_id`);--> statement-breakpoint
CREATE INDEX `campaign_sends_due_idx` ON `campaign_sends` (`status`, `next_attempt_at`);--> statement-breakpoint
CREATE INDEX `campaign_sends_ses_message_idx` ON `campaign_sends` (`ses_message_id`);
--> statement-breakpoint
CREATE TABLE `delivery_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `provider_event_id` text NOT NULL,
  `ses_message_id` text,
  `event_type` text NOT NULL,
  `payload` text NOT NULL,
  `received_at` text NOT NULL,
  CONSTRAINT `delivery_events_provider_event_id_unique` UNIQUE(`provider_event_id`)
);--> statement-breakpoint
CREATE INDEX `delivery_events_ses_message_idx` ON `delivery_events` (`ses_message_id`);
