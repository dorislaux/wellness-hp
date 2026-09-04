CREATE TABLE `daily_source_records` (
	`member_id` text NOT NULL,
	`local_date` text NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`readiness_score` integer,
	`hrv_balance_score` integer,
	`resting_heart_rate_contributor_score` integer,
	`sleep_balance_score` integer,
	`body_temperature_contributor_score` integer,
	`previous_day_activity_score` integer,
	`sleep_average_heart_rate_bpm` real,
	`sleep_average_hrv_ms` real,
	`sleep_total_seconds` integer,
	`deep_sleep_seconds` integer,
	`sleep_start_at` integer,
	`sleep_end_at` integer,
	`recovery_score` real,
	`day_strain` real,
	`source_updated_at` integer,
	`fetched_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`sanitized_error_code` text,
	PRIMARY KEY(`member_id`, `local_date`, `provider`),
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_daily_source_records_provider" CHECK("daily_source_records"."provider" IN ('oura', 'whoop')),
	CONSTRAINT "ck_daily_source_records_status" CHECK("daily_source_records"."status" IN ('complete', 'not_current', 'unavailable')),
	CONSTRAINT "ck_daily_source_records_readiness" CHECK("daily_source_records"."readiness_score" IS NULL OR "daily_source_records"."readiness_score" BETWEEN 0 AND 100),
	CONSTRAINT "ck_daily_source_records_recovery" CHECK("daily_source_records"."recovery_score" IS NULL OR "daily_source_records"."recovery_score" BETWEEN 0 AND 100),
	CONSTRAINT "ck_daily_source_records_strain" CHECK("daily_source_records"."day_strain" IS NULL OR "daily_source_records"."day_strain" BETWEEN 0 AND 21),
	CONSTRAINT "ck_daily_source_records_sleep_total" CHECK("daily_source_records"."sleep_total_seconds" IS NULL OR "daily_source_records"."sleep_total_seconds" >= 0),
	CONSTRAINT "ck_daily_source_records_deep_sleep" CHECK("daily_source_records"."deep_sleep_seconds" IS NULL OR ("daily_source_records"."deep_sleep_seconds" >= 0 AND ("daily_source_records"."sleep_total_seconds" IS NULL OR "daily_source_records"."deep_sleep_seconds" <= "daily_source_records"."sleep_total_seconds"))),
	CONSTRAINT "ck_daily_source_records_sleep_window" CHECK("daily_source_records"."sleep_start_at" IS NULL OR "daily_source_records"."sleep_end_at" IS NULL OR "daily_source_records"."sleep_end_at" > "daily_source_records"."sleep_start_at")
);
--> statement-breakpoint
CREATE TABLE `household_users` (
	`household_id` text NOT NULL,
	`site_user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`revoked_at` integer,
	PRIMARY KEY(`household_id`, `site_user_id`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_household_users_role" CHECK("household_users"."role" IN ('owner', 'viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_household_users_site_user_id` ON `household_users` (`site_user_id`);--> statement-breakpoint
CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`timezone` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`display_name` text NOT NULL,
	`initials` text NOT NULL,
	`avatar_key` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_members_display_order" CHECK("members"."display_order" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_members_household_order` ON `members` (`household_id`,`display_order`);--> statement-breakpoint
CREATE TABLE `oauth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`provider` text NOT NULL,
	`state_digest` text NOT NULL,
	`requested_scopes` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_oauth_sessions_provider" CHECK("oauth_sessions"."provider" IN ('oura', 'whoop')),
	CONSTRAINT "ck_oauth_sessions_status" CHECK("oauth_sessions"."status" IN ('pending', 'authorized', 'denied', 'expired', 'failed')),
	CONSTRAINT "ck_oauth_sessions_expiry" CHECK("oauth_sessions"."expires_at" > "oauth_sessions"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_oauth_sessions_provider_state` ON `oauth_sessions` (`provider`,`state_digest`);--> statement-breakpoint
CREATE INDEX `idx_oauth_sessions_expiry` ON `oauth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `provider_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_subject_hash` text,
	`granted_scopes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'connecting' NOT NULL,
	`connected_at` integer,
	`disconnected_at` integer,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_provider_connections_provider" CHECK("provider_connections"."provider" IN ('oura', 'whoop')),
	CONSTRAINT "ck_provider_connections_status" CHECK("provider_connections"."status" IN ('connecting', 'connected', 'action_required', 'disconnected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_provider_connections_member_provider` ON `provider_connections` (`member_id`,`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_provider_connections_subject` ON `provider_connections` (`provider`,`provider_subject_hash`);--> statement-breakpoint
CREATE TABLE `provider_credentials` (
	`connection_id` text PRIMARY KEY NOT NULL,
	`encrypted_token_set` text NOT NULL,
	`nonce` text NOT NULL,
	`key_version` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `provider_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_provider_credentials_key_version" CHECK("provider_credentials"."key_version" > 0),
	CONSTRAINT "ck_provider_credentials_expiry" CHECK("provider_credentials"."expires_at" > 0)
);
--> statement-breakpoint
CREATE TABLE `sleep_stage_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`local_date` text NOT NULL,
	`provider` text NOT NULL,
	`position` integer NOT NULL,
	`stage` text NOT NULL,
	`duration_seconds` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_sleep_stage_segments_provider" CHECK("sleep_stage_segments"."provider" IN ('oura', 'whoop')),
	CONSTRAINT "ck_sleep_stage_segments_stage" CHECK("sleep_stage_segments"."stage" IN ('rem', 'light', 'deep', 'awake')),
	CONSTRAINT "ck_sleep_stage_segments_position" CHECK("sleep_stage_segments"."position" >= 0),
	CONSTRAINT "ck_sleep_stage_segments_duration" CHECK("sleep_stage_segments"."duration_seconds" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sleep_stage_segments_position` ON `sleep_stage_segments` (`member_id`,`local_date`,`provider`,`position`);--> statement-breakpoint
CREATE TABLE `sync_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`local_date` text,
	`status` text NOT NULL,
	`error_code` text,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`connection_id`) REFERENCES `provider_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_sync_attempts_status" CHECK("sync_attempts"."status" IN ('started', 'succeeded', 'failed')),
	CONSTRAINT "ck_sync_attempts_window" CHECK("sync_attempts"."finished_at" IS NULL OR "sync_attempts"."finished_at" >= "sync_attempts"."started_at")
);
--> statement-breakpoint
CREATE INDEX `idx_sync_attempts_connection_started` ON `sync_attempts` (`connection_id`,`started_at`);--> statement-breakpoint
PRAGMA optimize;
