CREATE TABLE `follows` (
	`id` text PRIMARY KEY NOT NULL,
	`follower_id` text NOT NULL,
	`following_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `follows_pair_uq` ON `follows` (`follower_id`,`following_id`);--> statement-breakpoint
CREATE INDEX `follows_following_idx` ON `follows` (`following_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`email` text,
	`handle` text NOT NULL,
	`display_name` text,
	`avatar_r2_key` text,
	`bio` text,
	`status` text DEFAULT 'active' NOT NULL,
	`phone_verified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_uq` ON `users` (`phone`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_handle_uq` ON `users` (`handle`);--> statement-breakpoint
CREATE TABLE `creators` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kyc_status` text DEFAULT 'pending' NOT NULL,
	`kyc_reviewed_by` text,
	`kyc_reviewed_at` integer,
	`kyc_rejection_reason` text,
	`payout_msisdn` text,
	`payout_provider` text,
	`verified` integer DEFAULT false NOT NULL,
	`standing` text DEFAULT 'new' NOT NULL,
	`recorded_split_bps_override` integer,
	`live_split_bps_override` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`suspension_reason` text,
	`strike_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `creators_user_uq` ON `creators` (`user_id`);--> statement-breakpoint
CREATE TABLE `content` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_id` text NOT NULL,
	`kind` text DEFAULT 'video' NOT NULL,
	`title` text,
	`description` text,
	`r2_key` text,
	`thumbnail_r2_key` text,
	`duration_seconds` integer,
	`size_bytes` integer,
	`pricing` text DEFAULT 'free' NOT NULL,
	`price_ugx` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`like_count` integer DEFAULT 0 NOT NULL,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`purchase_count` integer DEFAULT 0 NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `content_creator_idx` ON `content` (`creator_id`);--> statement-breakpoint
CREATE INDEX `content_status_idx` ON `content` (`status`);--> statement-breakpoint
CREATE TABLE `content_tags` (
	`content_id` text NOT NULL,
	`tag_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_tags_pk` ON `content_tags` (`content_id`,`tag_id`);--> statement-breakpoint
CREATE INDEX `content_tags_tag_idx` ON `content_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_label_uq` ON `tags` (`label`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`user_id` text NOT NULL,
	`parent_id` text,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `comments_content_idx` ON `comments` (`content_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_a_id` text NOT NULL,
	`user_b_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_pair_uq` ON `conversations` (`user_a_id`,`user_b_id`);--> statement-breakpoint
CREATE TABLE `likes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`content_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `likes_pair_uq` ON `likes` (`user_id`,`content_id`);--> statement-breakpoint
CREATE INDEX `likes_content_idx` ON `likes` (`content_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`body` text NOT NULL,
	`read_at` integer,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `live_events` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_id` text NOT NULL,
	`title` text,
	`description` text,
	`declared_duration_min` integer NOT NULL,
	`ticket_price_ugx` integer NOT NULL,
	`price_floor_applied_ugx` integer NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`scheduled_start_at` integer,
	`started_at` integer,
	`ended_at` integer,
	`peak_concurrent_viewers` integer DEFAULT 0 NOT NULL,
	`tickets_sold` integer DEFAULT 0 NOT NULL,
	`streaming_minutes_consumed` integer DEFAULT 0 NOT NULL,
	`replay_r2_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `live_events_creator_idx` ON `live_events` (`creator_id`);--> statement-breakpoint
CREATE INDEX `live_events_status_idx` ON `live_events` (`status`);--> statement-breakpoint
CREATE TABLE `entitlements` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`content_id` text,
	`live_event_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entitlements_user_content_uq` ON `entitlements` (`user_id`,`content_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entitlements_user_live_uq` ON `entitlements` (`user_id`,`live_event_id`);--> statement-breakpoint
CREATE INDEX `entitlements_user_idx` ON `entitlements` (`user_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`buyer_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`content_id` text,
	`live_event_id` text,
	`gross_ugx` integer NOT NULL,
	`flutterwave_fee_ugx` integer NOT NULL,
	`net_pool_ugx` integer NOT NULL,
	`creator_share_ugx` integer NOT NULL,
	`platform_share_ugx` integer NOT NULL,
	`creator_split_bps` integer NOT NULL,
	`live_viewer_tier` text,
	`payment_status` text DEFAULT 'pending' NOT NULL,
	`flutterwave_tx_ref` text,
	`flutterwave_flw_id` text,
	`paid_at` integer,
	`refunded_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_tx_ref_uq` ON `transactions` (`flutterwave_tx_ref`);--> statement-breakpoint
CREATE INDEX `transactions_buyer_idx` ON `transactions` (`buyer_id`);--> statement-breakpoint
CREATE INDEX `transactions_creator_idx` ON `transactions` (`creator_id`);--> statement-breakpoint
CREATE INDEX `transactions_status_idx` ON `transactions` (`payment_status`);--> statement-breakpoint
CREATE TABLE `payout_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`min_payout_threshold_ugx` integer DEFAULT 0 NOT NULL,
	`total_amount_ugx` integer DEFAULT 0 NOT NULL,
	`payout_count` integer DEFAULT 0 NOT NULL,
	`approved_by_admin_id` text,
	`approved_at` integer,
	`executed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payouts` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`wallet_id` text NOT NULL,
	`gross_ugx` integer NOT NULL,
	`withdrawal_duty_ugx` integer DEFAULT 0 NOT NULL,
	`net_ugx` integer NOT NULL,
	`payout_msisdn` text,
	`payout_provider` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`flutterwave_transfer_id` text,
	`failure_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payouts_batch_idx` ON `payouts` (`batch_id`);--> statement-breakpoint
CREATE INDEX `payouts_creator_idx` ON `payouts` (`creator_id`);--> statement-breakpoint
CREATE TABLE `wallet_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_id` text NOT NULL,
	`type` text NOT NULL,
	`amount_ugx` integer NOT NULL,
	`balance_after_ugx` integer NOT NULL,
	`transaction_id` text,
	`payout_id` text,
	`memo` text,
	`created_by_admin_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wallet_entries_wallet_idx` ON `wallet_entries` (`wallet_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_id` text NOT NULL,
	`balance_ugx` integer DEFAULT 0 NOT NULL,
	`held_ugx` integer DEFAULT 0 NOT NULL,
	`lifetime_earned_ugx` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_creator_uq` ON `wallets` (`creator_id`);--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`totp_secret` text,
	`totp_enabled` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_email_uq` ON `admin_users` (`email`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_id` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`detail_json` text,
	`ip_address` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_admin_idx` ON `audit_log` (`admin_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_target_idx` ON `audit_log` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `moderation_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_user_id` text,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`reason` text,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_by_admin_id` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `moderation_reports_status_idx` ON `moderation_reports` (`status`);--> statement-breakpoint
CREATE INDEX `moderation_reports_target_idx` ON `moderation_reports` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `platform_config` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	`effective_from` integer NOT NULL,
	`created_by_admin_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `platform_config_key_idx` ON `platform_config` (`key`,`effective_from`);