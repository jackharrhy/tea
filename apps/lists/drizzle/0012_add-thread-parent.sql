ALTER TABLE `inbound_messages` ADD `in_reply_to` text;--> statement-breakpoint
ALTER TABLE `inbound_messages` ADD `parent_message_id` integer;