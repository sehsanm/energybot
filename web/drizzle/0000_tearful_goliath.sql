CREATE TABLE `admin_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_email_unique` ON `admin_users` (`email`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`admin_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_audit_created` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `bills` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`bill_id` text NOT NULL,
	`pay_id` text,
	`utility_type` text NOT NULL,
	`amount` integer NOT NULL,
	`term` text,
	`due_date` text,
	`consumption` real,
	`details` text DEFAULT '{}' NOT NULL,
	`suggestions` text,
	`created_at` integer NOT NULL,
	`legacy_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bills_legacy_id_unique` ON `bills` (`legacy_id`);--> statement-breakpoint
CREATE INDEX `ix_bills_user_created` ON `bills` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `login_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`channel` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_messages_user_created` ON `messages` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `processed_updates` (
	`channel` text NOT NULL,
	`update_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pk_processed_updates` ON `processed_updates` (`channel`,`update_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`household` text DEFAULT '{}' NOT NULL,
	`behaviour` text DEFAULT '{}' NOT NULL,
	`goals` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`user_id` text,
	`admin_id` text,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`admin_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_sessions_expires` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `user_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`channel` text NOT NULL,
	`external_id` text NOT NULL,
	`username` text,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_identities_channel_external` ON `user_identities` (`channel`,`external_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`language` text DEFAULT 'fa' NOT NULL,
	`is_blocked` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer,
	`legacy_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_legacy_id_unique` ON `users` (`legacy_id`);