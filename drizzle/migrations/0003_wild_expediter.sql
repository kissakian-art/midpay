CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text,
	`source` text DEFAULT 'device' NOT NULL,
	`title` text NOT NULL,
	`artist` text,
	`r2_key` text,
	`duration_seconds` integer,
	`size_bytes` integer,
	`is_public` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `tracks_public_idx` ON `tracks` (`is_public`);--> statement-breakpoint
CREATE INDEX `tracks_owner_idx` ON `tracks` (`owner_user_id`);--> statement-breakpoint
ALTER TABLE `content` ADD `music_track_id` text;--> statement-breakpoint
ALTER TABLE `content` ADD `music_start_ms` integer;