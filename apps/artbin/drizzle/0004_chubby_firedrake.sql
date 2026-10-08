CREATE TABLE `remote_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`destination_key` text NOT NULL,
	`source_url` text NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`game` text,
	`metadata` text NOT NULL,
	`folder_id` text NOT NULL,
	`job_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_remote_imports_source_destination` ON `remote_imports` (`provider`,`external_id`,`destination_key`);--> statement-breakpoint
CREATE INDEX `idx_remote_imports_folder_id` ON `remote_imports` (`folder_id`);