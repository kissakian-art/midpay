ALTER TABLE `live_events` ADD `shutdown_pending` integer DEFAULT false NOT NULL;
--> statement-breakpoint
-- Reconcile prior terminal events too: old code only changed database state.
UPDATE `live_events` SET `shutdown_pending` = 1 WHERE `status` IN ('ended', 'terminated', 'cancelled');
