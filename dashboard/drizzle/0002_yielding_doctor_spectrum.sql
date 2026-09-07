CREATE TABLE `household_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`token_digest` text NOT NULL,
	`invited_email` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`claimed_by_user_id` text,
	`claimed_at` integer,
	`consumed_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_household_invitations_expiry" CHECK("household_invitations"."expires_at" > "household_invitations"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_household_invitations_token` ON `household_invitations` (`token_digest`);--> statement-breakpoint
CREATE INDEX `idx_household_invitations_household_email` ON `household_invitations` (`household_id`,`invited_email`);--> statement-breakpoint
CREATE TABLE `household_join_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`invitation_id` text NOT NULL,
	`requester_user_id` text NOT NULL,
	`requester_email` text NOT NULL,
	`requester_display_name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by_user_id` text,
	`decided_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invitation_id`) REFERENCES `household_invitations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_household_join_requests_status" CHECK("household_join_requests"."status" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "ck_household_join_requests_decision" CHECK(("household_join_requests"."status" = 'pending' AND "household_join_requests"."decided_at" IS NULL AND "household_join_requests"."decided_by_user_id" IS NULL) OR ("household_join_requests"."status" != 'pending' AND "household_join_requests"."decided_at" IS NOT NULL AND "household_join_requests"."decided_by_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_household_join_requests_invitation` ON `household_join_requests` (`invitation_id`);--> statement-breakpoint
CREATE INDEX `idx_household_join_requests_household_status` ON `household_join_requests` (`household_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_household_join_requests_requester` ON `household_join_requests` (`requester_user_id`,`status`);--> statement-breakpoint
ALTER TABLE `household_users` ADD `email` text;--> statement-breakpoint
ALTER TABLE `household_users` ADD `display_name` text;