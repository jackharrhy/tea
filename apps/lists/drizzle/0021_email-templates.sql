CREATE TABLE `email_templates` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `slug` text NOT NULL UNIQUE,
  `name` text NOT NULL,
  `description` text,
  `status` text NOT NULL DEFAULT 'draft',
  `built_in` integer NOT NULL DEFAULT 0,
  `current_version_id` integer,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_template_versions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `template_id` integer NOT NULL REFERENCES `email_templates`(`id`) ON DELETE CASCADE,
  `version` integer NOT NULL,
  `source_format` text NOT NULL,
  `subject_source` text,
  `html_source` text,
  `text_source` text NOT NULL,
  `compiled_html` text,
  `sections` text NOT NULL DEFAULT '[]',
  `partials` text NOT NULL DEFAULT '{}',
  `created_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_template_versions_template_version_idx` ON `email_template_versions` (`template_id`, `version`);
--> statement-breakpoint
ALTER TABLE `campaigns` ADD `template_version_id` integer REFERENCES `email_template_versions`(`id`);
--> statement-breakpoint
ALTER TABLE `campaigns` ADD `template_sections` text NOT NULL DEFAULT '{}';
