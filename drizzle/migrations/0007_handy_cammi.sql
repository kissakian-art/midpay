CREATE TABLE `backgrounds` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text,
	`r2_key` text,
	`is_public` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `backgrounds_public_idx` ON `backgrounds` (`is_public`);--> statement-breakpoint
ALTER TABLE `users` ADD `is_admin` integer DEFAULT false NOT NULL;