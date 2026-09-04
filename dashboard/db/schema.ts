import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const nowMs = sql`(unixepoch() * 1000)`;

export const households = sqliteTable("households", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  createdAt: integer("created_at").notNull().default(nowMs),
  updatedAt: integer("updated_at").notNull().default(nowMs),
});

export const householdUsers = sqliteTable(
  "household_users",
  {
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    siteUserId: text("site_user_id").notNull(),
    role: text("role", { enum: ["owner", "viewer"] }).notNull(),
    createdAt: integer("created_at").notNull().default(nowMs),
    revokedAt: integer("revoked_at"),
  },
  (table) => [
    primaryKey({ columns: [table.householdId, table.siteUserId] }),
    uniqueIndex("uq_household_users_site_user_id").on(table.siteUserId),
    check("ck_household_users_role", sql`${table.role} IN ('owner', 'viewer')`),
  ],
);

export const members = sqliteTable(
  "members",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    initials: text("initials").notNull(),
    avatarKey: text("avatar_key").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    index("idx_members_household_order").on(table.householdId, table.displayOrder),
    check("ck_members_display_order", sql`${table.displayOrder} >= 0`),
  ],
);

export const providerConnections = sqliteTable(
  "provider_connections",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["oura", "whoop"] }).notNull(),
    providerSubjectHash: text("provider_subject_hash"),
    grantedScopes: text("granted_scopes").notNull().default(""),
    status: text("status", { enum: ["connecting", "connected", "action_required", "disconnected"] }).notNull().default("connecting"),
    connectedAt: integer("connected_at"),
    disconnectedAt: integer("disconnected_at"),
    lastAttemptAt: integer("last_attempt_at"),
    lastSuccessAt: integer("last_success_at"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("uq_provider_connections_member_provider").on(table.memberId, table.provider),
    uniqueIndex("uq_provider_connections_subject").on(table.provider, table.providerSubjectHash),
    check("ck_provider_connections_provider", sql`${table.provider} IN ('oura', 'whoop')`),
    check("ck_provider_connections_status", sql`${table.status} IN ('connecting', 'connected', 'action_required', 'disconnected')`),
  ],
);

export const providerCredentials = sqliteTable("provider_credentials", {
  connectionId: text("connection_id").primaryKey().references(() => providerConnections.id, { onDelete: "cascade" }),
  encryptedTokenSet: text("encrypted_token_set").notNull(),
  nonce: text("nonce").notNull(),
  keyVersion: integer("key_version").notNull(),
  expiresAt: integer("expires_at").notNull(),
  updatedAt: integer("updated_at").notNull().default(nowMs),
}, (table) => [
  check("ck_provider_credentials_key_version", sql`${table.keyVersion} > 0`),
  check("ck_provider_credentials_expiry", sql`${table.expiresAt} > 0`),
]);

export const oauthSessions = sqliteTable(
  "oauth_sessions",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["oura", "whoop"] }).notNull(),
    stateDigest: text("state_digest").notNull(),
    requestedScopes: text("requested_scopes").notNull(),
    status: text("status", { enum: ["pending", "authorized", "denied", "expired", "failed"] }).notNull().default("pending"),
    createdByUserId: text("created_by_user_id").notNull(),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("uq_oauth_sessions_provider_state").on(table.provider, table.stateDigest),
    index("idx_oauth_sessions_expiry").on(table.expiresAt),
    check("ck_oauth_sessions_provider", sql`${table.provider} IN ('oura', 'whoop')`),
    check("ck_oauth_sessions_status", sql`${table.status} IN ('pending', 'authorized', 'denied', 'expired', 'failed')`),
    check("ck_oauth_sessions_expiry", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const dailySourceRecords = sqliteTable(
  "daily_source_records",
  {
    memberId: text("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
    localDate: text("local_date").notNull(),
    provider: text("provider", { enum: ["oura", "whoop"] }).notNull(),
    status: text("status", { enum: ["complete", "not_current", "unavailable"] }).notNull(),
    readinessScore: integer("readiness_score"),
    hrvBalanceScore: integer("hrv_balance_score"),
    restingHeartRateContributorScore: integer("resting_heart_rate_contributor_score"),
    sleepBalanceScore: integer("sleep_balance_score"),
    bodyTemperatureContributorScore: integer("body_temperature_contributor_score"),
    previousDayActivityScore: integer("previous_day_activity_score"),
    sleepAverageHeartRateBpm: real("sleep_average_heart_rate_bpm"),
    sleepAverageHrvMs: real("sleep_average_hrv_ms"),
    sleepTotalSeconds: integer("sleep_total_seconds"),
    deepSleepSeconds: integer("deep_sleep_seconds"),
    sleepStartAt: integer("sleep_start_at"),
    sleepEndAt: integer("sleep_end_at"),
    recoveryScore: real("recovery_score"),
    dayStrain: real("day_strain"),
    sourceUpdatedAt: integer("source_updated_at"),
    fetchedAt: integer("fetched_at").notNull().default(nowMs),
    sanitizedErrorCode: text("sanitized_error_code"),
  },
  (table) => [
    primaryKey({ columns: [table.memberId, table.localDate, table.provider] }),
    check("ck_daily_source_records_provider", sql`${table.provider} IN ('oura', 'whoop')`),
    check("ck_daily_source_records_status", sql`${table.status} IN ('complete', 'not_current', 'unavailable')`),
    check("ck_daily_source_records_readiness", sql`${table.readinessScore} IS NULL OR ${table.readinessScore} BETWEEN 0 AND 100`),
    check("ck_daily_source_records_recovery", sql`${table.recoveryScore} IS NULL OR ${table.recoveryScore} BETWEEN 0 AND 100`),
    check("ck_daily_source_records_strain", sql`${table.dayStrain} IS NULL OR ${table.dayStrain} BETWEEN 0 AND 21`),
    check("ck_daily_source_records_sleep_total", sql`${table.sleepTotalSeconds} IS NULL OR ${table.sleepTotalSeconds} >= 0`),
    check("ck_daily_source_records_deep_sleep", sql`${table.deepSleepSeconds} IS NULL OR (${table.deepSleepSeconds} >= 0 AND (${table.sleepTotalSeconds} IS NULL OR ${table.deepSleepSeconds} <= ${table.sleepTotalSeconds}))`),
    check("ck_daily_source_records_sleep_window", sql`${table.sleepStartAt} IS NULL OR ${table.sleepEndAt} IS NULL OR ${table.sleepEndAt} > ${table.sleepStartAt}`),
  ],
);

export const sleepStageSegments = sqliteTable(
  "sleep_stage_segments",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
    localDate: text("local_date").notNull(),
    provider: text("provider", { enum: ["oura", "whoop"] }).notNull(),
    position: integer("position").notNull(),
    stage: text("stage", { enum: ["rem", "light", "deep", "awake"] }).notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
  },
  (table) => [
    uniqueIndex("uq_sleep_stage_segments_position").on(table.memberId, table.localDate, table.provider, table.position),
    check("ck_sleep_stage_segments_provider", sql`${table.provider} IN ('oura', 'whoop')`),
    check("ck_sleep_stage_segments_stage", sql`${table.stage} IN ('rem', 'light', 'deep', 'awake')`),
    check("ck_sleep_stage_segments_position", sql`${table.position} >= 0`),
    check("ck_sleep_stage_segments_duration", sql`${table.durationSeconds} > 0`),
  ],
);

export const syncAttempts = sqliteTable(
  "sync_attempts",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull().references(() => providerConnections.id, { onDelete: "cascade" }),
    localDate: text("local_date"),
    status: text("status", { enum: ["started", "succeeded", "failed"] }).notNull(),
    errorCode: text("error_code"),
    startedAt: integer("started_at").notNull().default(nowMs),
    finishedAt: integer("finished_at"),
  },
  (table) => [
    index("idx_sync_attempts_connection_started").on(table.connectionId, table.startedAt),
    check("ck_sync_attempts_status", sql`${table.status} IN ('started', 'succeeded', 'failed')`),
    check("ck_sync_attempts_window", sql`${table.finishedAt} IS NULL OR ${table.finishedAt} >= ${table.startedAt}`),
  ],
);
