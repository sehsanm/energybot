DROP INDEX `pk_processed_updates`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_processed_updates_channel_update` ON `processed_updates` (`channel`,`update_id`);