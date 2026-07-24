CREATE TABLE `comment_likes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`comment_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comment_likes_pair_uq` ON `comment_likes` (`user_id`,`comment_id`);--> statement-breakpoint
CREATE INDEX `comment_likes_comment_idx` ON `comment_likes` (`comment_id`);--> statement-breakpoint
ALTER TABLE `comments` ADD `like_count` integer DEFAULT 0 NOT NULL;