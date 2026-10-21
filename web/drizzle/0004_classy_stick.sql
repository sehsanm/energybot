CREATE TABLE `badges_earned` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`badge_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_badges_earned_user_key` ON `badges_earned` (`user_id`,`badge_key`);--> statement-breakpoint
CREATE TABLE `coin_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`ref` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_coin_events_user` ON `coin_events` (`user_id`);--> statement-breakpoint
CREATE TABLE `lesson_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`course_slug` text NOT NULL,
	`lesson_slug` text NOT NULL,
	`accuracy` real NOT NULL,
	`first_try_accuracy` real NOT NULL,
	`xp` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_lesson_completions_user` ON `lesson_completions` (`user_id`);--> statement-breakpoint
CREATE TABLE `streak_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`current` integer NOT NULL,
	`best` integer NOT NULL,
	`last_active_date` text NOT NULL,
	`freezes` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `xp_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`ref` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_xp_events_user` ON `xp_events` (`user_id`);