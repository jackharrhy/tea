ALTER TABLE `email_templates` ADD `source_format` text;
--> statement-breakpoint
ALTER TABLE `email_templates` ADD `subject_source` text;
--> statement-breakpoint
ALTER TABLE `email_templates` ADD `html_source` text;
--> statement-breakpoint
ALTER TABLE `email_templates` ADD `text_source` text;
--> statement-breakpoint
ALTER TABLE `email_templates` ADD `compiled_html` text;
--> statement-breakpoint
ALTER TABLE `email_templates` ADD `sections` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `email_templates` ADD `partials` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
UPDATE `email_templates` SET `current_version_id` = COALESCE(
  `current_version_id`,
  (SELECT `id` FROM `email_template_versions` WHERE `template_id` = `email_templates`.`id` ORDER BY `version` DESC LIMIT 1)
);
--> statement-breakpoint
UPDATE `email_templates` SET
  `source_format` = (SELECT `source_format` FROM `email_template_versions` WHERE `id` = `email_templates`.`current_version_id`),
  `subject_source` = (SELECT `subject_source` FROM `email_template_versions` WHERE `id` = `email_templates`.`current_version_id`),
  `html_source` = (SELECT `html_source` FROM `email_template_versions` WHERE `id` = `email_templates`.`current_version_id`),
  `text_source` = (SELECT `text_source` FROM `email_template_versions` WHERE `id` = `email_templates`.`current_version_id`),
  `compiled_html` = (SELECT `compiled_html` FROM `email_template_versions` WHERE `id` = `email_templates`.`current_version_id`),
  `sections` = COALESCE((SELECT `sections` FROM `email_template_versions` WHERE `id` = `email_templates`.`current_version_id`), '[]'),
  `partials` = COALESCE((SELECT `partials` FROM `email_template_versions` WHERE `id` = `email_templates`.`current_version_id`), '{}');
--> statement-breakpoint
ALTER TABLE `campaigns` DROP COLUMN `template_version_id`;
--> statement-breakpoint
DROP TABLE `email_template_versions`;
--> statement-breakpoint
ALTER TABLE `email_templates` DROP COLUMN `current_version_id`;
