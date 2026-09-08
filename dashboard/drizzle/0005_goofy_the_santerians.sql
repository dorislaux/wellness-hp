CREATE TABLE `household_user_members` (
	`household_id` text NOT NULL,
	`site_user_id` text NOT NULL,
	`member_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`household_id`, `site_user_id`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_household_user_members_member_id` ON `household_user_members` (`member_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `household_user_members` (`household_id`, `site_user_id`, `member_id`)
SELECT '29c956f9-3cd2-40c3-8cd2-65b0f5bda37a', 'CNoVzHlhxRcHgnyGERMtyD0znBBR77GgoiTmsFdDdWS3cpznlqWoZN', 'be443fc3-b048-4055-9c0b-e1a2cc174934'
WHERE EXISTS (SELECT 1 FROM `household_users` WHERE `household_id` = '29c956f9-3cd2-40c3-8cd2-65b0f5bda37a' AND `site_user_id` = 'CNoVzHlhxRcHgnyGERMtyD0znBBR77GgoiTmsFdDdWS3cpznlqWoZN' AND `revoked_at` IS NULL)
  AND EXISTS (SELECT 1 FROM `members` WHERE `id` = 'be443fc3-b048-4055-9c0b-e1a2cc174934' AND `household_id` = '29c956f9-3cd2-40c3-8cd2-65b0f5bda37a');
--> statement-breakpoint
INSERT OR IGNORE INTO `household_user_members` (`household_id`, `site_user_id`, `member_id`)
SELECT '29c956f9-3cd2-40c3-8cd2-65b0f5bda37a', 'qr8PKdx00KBkoRdpOPUHlHcQThXkGNPbJnJ6UjaJkg8DLKK0h43AIm', 'd8c1a0f1-849d-48c7-92d3-b82b7609a537'
WHERE EXISTS (SELECT 1 FROM `household_users` WHERE `household_id` = '29c956f9-3cd2-40c3-8cd2-65b0f5bda37a' AND `site_user_id` = 'qr8PKdx00KBkoRdpOPUHlHcQThXkGNPbJnJ6UjaJkg8DLKK0h43AIm' AND `revoked_at` IS NULL)
  AND EXISTS (SELECT 1 FROM `members` WHERE `id` = 'd8c1a0f1-849d-48c7-92d3-b82b7609a537' AND `household_id` = '29c956f9-3cd2-40c3-8cd2-65b0f5bda37a');
--> statement-breakpoint
INSERT OR IGNORE INTO `household_user_members` (`household_id`, `site_user_id`, `member_id`)
SELECT '4732e1ed-76a2-471e-b10f-3b4f73be6def', 'EDJd28OoxsSJvcQnhcWaBFXxA8QyNqJslDVXwyIlPP0eeZl8HsovV7', '170812d5-7bf8-423c-8509-2e004e9383c3'
WHERE EXISTS (SELECT 1 FROM `household_users` WHERE `household_id` = '4732e1ed-76a2-471e-b10f-3b4f73be6def' AND `site_user_id` = 'EDJd28OoxsSJvcQnhcWaBFXxA8QyNqJslDVXwyIlPP0eeZl8HsovV7' AND `revoked_at` IS NULL)
  AND EXISTS (SELECT 1 FROM `members` WHERE `id` = '170812d5-7bf8-423c-8509-2e004e9383c3' AND `household_id` = '4732e1ed-76a2-471e-b10f-3b4f73be6def');
--> statement-breakpoint
INSERT OR IGNORE INTO `members` (`id`, `household_id`, `display_name`, `initials`, `avatar_key`, `display_order`, `active`, `created_at`, `updated_at`)
SELECT '70f2e0a9-3f95-4c80-92ce-ae93d81e787c', `household_id`, COALESCE(NULLIF(TRIM(`display_name`), ''), 'Household member'), 'JX', 'blue',
  COALESCE((SELECT MAX(`display_order`) + 1 FROM `members` WHERE `household_id` = '29c956f9-3cd2-40c3-8cd2-65b0f5bda37a'), 0), 1,
  (unixepoch() * 1000), (unixepoch() * 1000)
FROM `household_users`
WHERE `household_id` = '29c956f9-3cd2-40c3-8cd2-65b0f5bda37a'
  AND `site_user_id` = 'mFGkHOkKq1Uwo97OSIIjWbXFrJnqBujJrNgVS9DU7M0ZFBwYWszl16'
  AND `revoked_at` IS NULL
  AND NOT EXISTS (SELECT 1 FROM `household_user_members` WHERE `household_id` = '29c956f9-3cd2-40c3-8cd2-65b0f5bda37a' AND `site_user_id` = 'mFGkHOkKq1Uwo97OSIIjWbXFrJnqBujJrNgVS9DU7M0ZFBwYWszl16');
--> statement-breakpoint
INSERT OR IGNORE INTO `household_user_members` (`household_id`, `site_user_id`, `member_id`)
SELECT '29c956f9-3cd2-40c3-8cd2-65b0f5bda37a', 'mFGkHOkKq1Uwo97OSIIjWbXFrJnqBujJrNgVS9DU7M0ZFBwYWszl16', '70f2e0a9-3f95-4c80-92ce-ae93d81e787c'
WHERE EXISTS (SELECT 1 FROM `household_users` WHERE `household_id` = '29c956f9-3cd2-40c3-8cd2-65b0f5bda37a' AND `site_user_id` = 'mFGkHOkKq1Uwo97OSIIjWbXFrJnqBujJrNgVS9DU7M0ZFBwYWszl16' AND `revoked_at` IS NULL)
  AND EXISTS (SELECT 1 FROM `members` WHERE `id` = '70f2e0a9-3f95-4c80-92ce-ae93d81e787c' AND `household_id` = '29c956f9-3cd2-40c3-8cd2-65b0f5bda37a');
