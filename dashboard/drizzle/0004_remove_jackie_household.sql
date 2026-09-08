DELETE FROM `provider_credentials`
WHERE `connection_id` IN (
  SELECT `provider_connections`.`id`
  FROM `provider_connections`
  INNER JOIN `members` ON `members`.`id` = `provider_connections`.`member_id`
  WHERE `members`.`household_id` = 'fcaf3cf2-f2bc-460a-9a5c-6ac09aa15976'
);
--> statement-breakpoint
DELETE FROM `sync_attempts`
WHERE `connection_id` IN (
  SELECT `provider_connections`.`id`
  FROM `provider_connections`
  INNER JOIN `members` ON `members`.`id` = `provider_connections`.`member_id`
  WHERE `members`.`household_id` = 'fcaf3cf2-f2bc-460a-9a5c-6ac09aa15976'
);
--> statement-breakpoint
DELETE FROM `oauth_sessions`
WHERE `member_id` IN (
  SELECT `id` FROM `members`
  WHERE `household_id` = 'fcaf3cf2-f2bc-460a-9a5c-6ac09aa15976'
);
--> statement-breakpoint
DELETE FROM `daily_source_records`
WHERE `member_id` IN (
  SELECT `id` FROM `members`
  WHERE `household_id` = 'fcaf3cf2-f2bc-460a-9a5c-6ac09aa15976'
);
--> statement-breakpoint
DELETE FROM `sleep_stage_segments`
WHERE `member_id` IN (
  SELECT `id` FROM `members`
  WHERE `household_id` = 'fcaf3cf2-f2bc-460a-9a5c-6ac09aa15976'
);
--> statement-breakpoint
DELETE FROM `provider_connections`
WHERE `member_id` IN (
  SELECT `id` FROM `members`
  WHERE `household_id` = 'fcaf3cf2-f2bc-460a-9a5c-6ac09aa15976'
);
--> statement-breakpoint
DELETE FROM `members`
WHERE `household_id` = 'fcaf3cf2-f2bc-460a-9a5c-6ac09aa15976';
--> statement-breakpoint
DELETE FROM `household_join_requests`
WHERE `household_id` = 'fcaf3cf2-f2bc-460a-9a5c-6ac09aa15976';
--> statement-breakpoint
DELETE FROM `household_invitations`
WHERE `household_id` = 'fcaf3cf2-f2bc-460a-9a5c-6ac09aa15976';
--> statement-breakpoint
DELETE FROM `household_users`
WHERE `household_id` = 'fcaf3cf2-f2bc-460a-9a5c-6ac09aa15976';
--> statement-breakpoint
DELETE FROM `households`
WHERE `id` = 'fcaf3cf2-f2bc-460a-9a5c-6ac09aa15976';
