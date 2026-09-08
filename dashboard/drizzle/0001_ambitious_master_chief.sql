PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_daily_source_records` (
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
	`total_calories` integer,
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
	CONSTRAINT "ck_daily_source_records_provider" CHECK("provider" IN ('oura', 'whoop')),
	CONSTRAINT "ck_daily_source_records_status" CHECK("status" IN ('complete', 'not_current', 'unavailable')),
	CONSTRAINT "ck_daily_source_records_readiness" CHECK("readiness_score" IS NULL OR "readiness_score" BETWEEN 0 AND 100),
	CONSTRAINT "ck_daily_source_records_recovery" CHECK("recovery_score" IS NULL OR "recovery_score" BETWEEN 0 AND 100),
	CONSTRAINT "ck_daily_source_records_strain" CHECK("day_strain" IS NULL OR "day_strain" BETWEEN 0 AND 21),
	CONSTRAINT "ck_daily_source_records_total_calories" CHECK("total_calories" IS NULL OR "total_calories" >= 0),
	CONSTRAINT "ck_daily_source_records_sleep_total" CHECK("sleep_total_seconds" IS NULL OR "sleep_total_seconds" >= 0),
	CONSTRAINT "ck_daily_source_records_deep_sleep" CHECK("deep_sleep_seconds" IS NULL OR ("deep_sleep_seconds" >= 0 AND ("sleep_total_seconds" IS NULL OR "deep_sleep_seconds" <= "sleep_total_seconds"))),
	CONSTRAINT "ck_daily_source_records_sleep_window" CHECK("sleep_start_at" IS NULL OR "sleep_end_at" IS NULL OR "sleep_end_at" > "sleep_start_at")
);
--> statement-breakpoint
INSERT INTO `__new_daily_source_records`("member_id", "local_date", "provider", "status", "readiness_score", "hrv_balance_score", "resting_heart_rate_contributor_score", "sleep_balance_score", "body_temperature_contributor_score", "previous_day_activity_score", "total_calories", "sleep_average_heart_rate_bpm", "sleep_average_hrv_ms", "sleep_total_seconds", "deep_sleep_seconds", "sleep_start_at", "sleep_end_at", "recovery_score", "day_strain", "source_updated_at", "fetched_at", "sanitized_error_code") SELECT "member_id", "local_date", "provider", "status", "readiness_score", "hrv_balance_score", "resting_heart_rate_contributor_score", "sleep_balance_score", "body_temperature_contributor_score", "previous_day_activity_score", NULL, "sleep_average_heart_rate_bpm", "sleep_average_hrv_ms", "sleep_total_seconds", "deep_sleep_seconds", "sleep_start_at", "sleep_end_at", "recovery_score", "day_strain", "source_updated_at", "fetched_at", "sanitized_error_code" FROM `daily_source_records`;--> statement-breakpoint
DROP TABLE `daily_source_records`;--> statement-breakpoint
ALTER TABLE `__new_daily_source_records` RENAME TO `daily_source_records`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
