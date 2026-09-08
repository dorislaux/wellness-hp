CREATE TABLE `wellness_snapshot_cache` (
	`household_id` text PRIMARY KEY NOT NULL,
	`local_date` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`snapshot_json` text NOT NULL,
	`generated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_wellness_snapshot_cache_schema_version" CHECK("wellness_snapshot_cache"."schema_version" > 0)
);
