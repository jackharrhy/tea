ALTER TABLE `files` ADD `status` text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `suggested_folder_id` text REFERENCES folders(id);--> statement-breakpoint
CREATE INDEX `idx_files_status` ON `files` (`status`);