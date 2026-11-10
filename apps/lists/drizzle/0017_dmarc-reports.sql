CREATE TABLE `dmarc_reports` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `report_key` text NOT NULL,
  `reporter_org` text NOT NULL,
  `reporter_email` text,
  `external_report_id` text NOT NULL,
  `domain` text NOT NULL,
  `date_begin` text NOT NULL,
  `date_end` text NOT NULL,
  `policy` text NOT NULL,
  `subdomain_policy` text,
  `nonexistent_subdomain_policy` text,
  `adkim` text NOT NULL DEFAULT 'r',
  `aspf` text NOT NULL DEFAULT 'r',
  `testing` text,
  `discovery_method` text,
  `message_count` integer NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `dmarc_reports_report_key_unique` UNIQUE(`report_key`)
);--> statement-breakpoint
CREATE INDEX `dmarc_reports_domain_range_idx` ON `dmarc_reports` (`domain`, `date_begin`, `date_end`);--> statement-breakpoint
CREATE TABLE `dmarc_report_records` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `report_id` integer NOT NULL,
  `source_ip` text NOT NULL,
  `count` integer NOT NULL,
  `disposition` text NOT NULL,
  `dkim_result` text NOT NULL,
  `spf_result` text NOT NULL,
  `dmarc_pass` integer NOT NULL,
  `header_from` text NOT NULL,
  `envelope_from` text,
  `envelope_to` text,
  `override_reasons` text NOT NULL DEFAULT '[]',
  `auth_results` text NOT NULL DEFAULT '{}',
  FOREIGN KEY (`report_id`) REFERENCES `dmarc_reports`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `dmarc_records_report_idx` ON `dmarc_report_records` (`report_id`);--> statement-breakpoint
CREATE INDEX `dmarc_records_source_idx` ON `dmarc_report_records` (`source_ip`);--> statement-breakpoint
CREATE TABLE `dmarc_ingestions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `ses_message_id` text NOT NULL,
  `raw_s3_key` text NOT NULL,
  `status` text NOT NULL DEFAULT 'processing',
  `error` text,
  `report_id` integer,
  `received_at` text NOT NULL,
  `processed_at` text,
  FOREIGN KEY (`report_id`) REFERENCES `dmarc_reports`(`id`) ON UPDATE no action ON DELETE set null,
  CONSTRAINT `dmarc_ingestions_ses_message_id_unique` UNIQUE(`ses_message_id`)
);--> statement-breakpoint
CREATE INDEX `dmarc_ingestions_status_idx` ON `dmarc_ingestions` (`status`);
