CREATE TABLE `auth_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`attempts` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_open_content_uq` ON `transactions` (`buyer_id`,`content_id`) WHERE "transactions"."payment_status" in ('pending', 'paid');--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_open_live_uq` ON `transactions` (`buyer_id`,`live_event_id`) WHERE "transactions"."payment_status" in ('pending', 'paid');--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_provider_id_uq` ON `transactions` (`flutterwave_flw_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_entries_sale_uq` ON `wallet_entries` (`transaction_id`) WHERE "wallet_entries"."type" = 'sale_credit';--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_entries_hold_uq` ON `wallet_entries` (`payout_id`) WHERE "wallet_entries"."type" = 'hold';--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_entries_completion_uq` ON `wallet_entries` (`payout_id`) WHERE "wallet_entries"."type" in ('release', 'payout_debit');