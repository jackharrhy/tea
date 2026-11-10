ALTER TABLE `subscribers` ADD `first_name` text;--> statement-breakpoint
ALTER TABLE `subscribers` ADD `last_name` text;--> statement-breakpoint
ALTER TABLE `subscribers` DROP COLUMN `name`;
