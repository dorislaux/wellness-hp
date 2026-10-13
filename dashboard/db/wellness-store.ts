import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, type Database } from "./index";
import { dailySourceRecords, members, providerConnections, sleepStageSegments, syncAttempts,
  wellnessSnapshotCache } from "./schema";
import { writeBatches } from "./write-batches";

export type DailyRecordInput = typeof dailySourceRecords.$inferInsert;
export type SleepStageInput = typeof sleepStageSegments.$inferInsert;
const SLEEP_STAGE_INSERT_BATCH_SIZE = 12;
const SNAPSHOT_SCHEMA_VERSION = 4;
export const OURA_ACTIVE_CALORIE_BACKFILL_MARKER = "oura_active_calories_v1";

export async function readWellnessSnapshotCache(householdId: string, localDate: string, database?: Database) {
  const db = database ?? await getDb();
  const [cached] = await db.select({ snapshotJson: wellnessSnapshotCache.snapshotJson,
    generatedAt: wellnessSnapshotCache.generatedAt }).from(wellnessSnapshotCache)
    .where(and(eq(wellnessSnapshotCache.householdId, householdId),
      eq(wellnessSnapshotCache.localDate, localDate),
      eq(wellnessSnapshotCache.schemaVersion, SNAPSHOT_SCHEMA_VERSION))).limit(1);
  return cached ?? null;
}

export async function replaceWellnessSnapshotCache(input: {
  householdId: string;
  localDate: string;
  snapshotJson: string;
}, database?: Database) {
  const db = database ?? await getDb();
  const generatedAt = Date.now();
  await db.insert(wellnessSnapshotCache).values({ ...input, schemaVersion: SNAPSHOT_SCHEMA_VERSION, generatedAt })
    .onConflictDoUpdate({ target: wellnessSnapshotCache.householdId, set: {
      localDate: input.localDate,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      snapshotJson: input.snapshotJson,
      generatedAt,
    } });
}

export async function invalidateWellnessSnapshotCache(householdId: string, database?: Database) {
  const db = database ?? await getDb();
  await db.delete(wellnessSnapshotCache).where(eq(wellnessSnapshotCache.householdId, householdId));
}

export async function listHouseholdConnections(householdId: string, database?: Database) {
  const db = database ?? await getDb();
  return db.select({ id: providerConnections.id, memberId: providerConnections.memberId,
    provider: providerConnections.provider, status: providerConnections.status,
    grantedScopes: providerConnections.grantedScopes, lastSuccessAt: providerConnections.lastSuccessAt })
    .from(providerConnections).innerJoin(members, eq(providerConnections.memberId, members.id))
    .where(and(eq(members.householdId, householdId), eq(members.active, true)))
    .orderBy(asc(members.displayOrder));
}

export async function markConnectionAttempt(connectionId: string, status: "connected" | "action_required",
  succeeded: boolean, database?: Database) {
  const db = database ?? await getDb();
  const now = Date.now();
  await db.update(providerConnections).set({ status, lastAttemptAt: now,
    ...(succeeded ? { lastSuccessAt: now } : {}), updatedAt: now })
    .where(eq(providerConnections.id, connectionId));
}

export async function upsertDailyRecords(records: DailyRecordInput[], database?: Database) {
  if (!records.length) return;
  const db = database ?? await getDb();
  for (const item of records) {
    if (item.status !== "complete") {
      const [existing] = await db.select({ status: dailySourceRecords.status }).from(dailySourceRecords)
        .where(and(eq(dailySourceRecords.memberId, item.memberId), eq(dailySourceRecords.localDate, item.localDate),
          eq(dailySourceRecords.provider, item.provider))).limit(1);
      if (existing?.status === "complete") continue;
    }
    await db.insert(dailySourceRecords).values(item).onConflictDoUpdate({
      target: [dailySourceRecords.memberId, dailySourceRecords.localDate, dailySourceRecords.provider],
      set: { status: item.status,
        readinessScore: sql`coalesce(excluded.readiness_score, ${dailySourceRecords.readinessScore})`,
        hrvBalanceScore: sql`coalesce(excluded.hrv_balance_score, ${dailySourceRecords.hrvBalanceScore})`,
        restingHeartRateContributorScore: sql`coalesce(excluded.resting_heart_rate_contributor_score, ${dailySourceRecords.restingHeartRateContributorScore})`,
        sleepBalanceScore: sql`coalesce(excluded.sleep_balance_score, ${dailySourceRecords.sleepBalanceScore})`,
        bodyTemperatureContributorScore: sql`coalesce(excluded.body_temperature_contributor_score, ${dailySourceRecords.bodyTemperatureContributorScore})`,
        bodyTemperatureDeviationC: sql`coalesce(excluded.body_temperature_deviation_c, ${dailySourceRecords.bodyTemperatureDeviationC})`,
        skinTemperatureC: sql`coalesce(excluded.skin_temperature_c, ${dailySourceRecords.skinTemperatureC})`,
        previousDayActivityScore: sql`coalesce(excluded.previous_day_activity_score, ${dailySourceRecords.previousDayActivityScore})`,
        totalCalories: sql`coalesce(excluded.total_calories, ${dailySourceRecords.totalCalories})`,
        activeCalories: sql`coalesce(excluded.active_calories, ${dailySourceRecords.activeCalories})`,
        sleepAverageHeartRateBpm: sql`coalesce(excluded.sleep_average_heart_rate_bpm, ${dailySourceRecords.sleepAverageHeartRateBpm})`,
        sleepAverageHrvMs: sql`coalesce(excluded.sleep_average_hrv_ms, ${dailySourceRecords.sleepAverageHrvMs})`,
        respiratoryRate: sql`coalesce(excluded.respiratory_rate, ${dailySourceRecords.respiratoryRate})`,
        sleepTotalSeconds: sql`coalesce(excluded.sleep_total_seconds, ${dailySourceRecords.sleepTotalSeconds})`,
        deepSleepSeconds: sql`coalesce(excluded.deep_sleep_seconds, ${dailySourceRecords.deepSleepSeconds})`,
        sleepStartAt: sql`coalesce(excluded.sleep_start_at, ${dailySourceRecords.sleepStartAt})`,
        sleepEndAt: sql`coalesce(excluded.sleep_end_at, ${dailySourceRecords.sleepEndAt})`,
        recoveryScore: sql`coalesce(excluded.recovery_score, ${dailySourceRecords.recoveryScore})`,
        dayStrain: sql`coalesce(excluded.day_strain, ${dailySourceRecords.dayStrain})`,
        sourceUpdatedAt: sql`coalesce(excluded.source_updated_at, ${dailySourceRecords.sourceUpdatedAt})`,
        fetchedAt: item.fetchedAt ?? Date.now(),
        sanitizedErrorCode: item.sanitizedErrorCode ?? null },
    });
  }
}

export async function oldestIncompleteSourceDate(input: { memberId: string; provider: "oura" | "whoop";
  startDate: string; endDate: string }, database?: Database) {
  const db = database ?? await getDb();
  const [record] = await db.select({ localDate: dailySourceRecords.localDate }).from(dailySourceRecords)
    .where(and(eq(dailySourceRecords.memberId, input.memberId), eq(dailySourceRecords.provider, input.provider),
      eq(dailySourceRecords.status, "not_current"), gte(dailySourceRecords.localDate, input.startDate),
      lte(dailySourceRecords.localDate, input.endDate))).orderBy(asc(dailySourceRecords.localDate)).limit(1);
  return record?.localDate ?? null;
}

export async function oldestMissingActiveCaloriesDate(memberId: string, startDate: string, endDate: string,
  database?: Database) {
  const db = database ?? await getDb();
  const [record] = await db.select({ localDate: dailySourceRecords.localDate }).from(dailySourceRecords)
    .where(and(eq(dailySourceRecords.memberId, memberId), eq(dailySourceRecords.provider, "oura"),
      eq(dailySourceRecords.status, "complete"), sql`${dailySourceRecords.activeCalories} IS NULL`,
      sql`${dailySourceRecords.totalCalories} IS NOT NULL`, gte(dailySourceRecords.localDate, startDate),
      lte(dailySourceRecords.localDate, endDate))).orderBy(asc(dailySourceRecords.localDate)).limit(1);
  return record?.localDate ?? null;
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export async function nextOuraActiveCaloriesBackfillDate(memberId: string, startDate: string, endDate: string,
  database?: Database) {
  const db = database ?? await getDb();
  const records = await db.select({ localDate: dailySourceRecords.localDate, status: dailySourceRecords.status,
    activeCalories: dailySourceRecords.activeCalories, sanitizedErrorCode: dailySourceRecords.sanitizedErrorCode })
    .from(dailySourceRecords).where(and(eq(dailySourceRecords.memberId, memberId),
      eq(dailySourceRecords.provider, "oura"), gte(dailySourceRecords.localDate, startDate),
      lte(dailySourceRecords.localDate, endDate)));
  const byDate = new Map(records.map((record) => [record.localDate, record]));
  for (let cursor = startDate; cursor <= endDate; cursor = shiftDate(cursor, 1)) {
    const record = byDate.get(cursor);
    if (!record) return cursor;
    if (record.activeCalories === null && record.sanitizedErrorCode !== OURA_ACTIVE_CALORIE_BACKFILL_MARKER) return cursor;
  }
  return null;
}

export async function storeOuraActiveCaloriesBackfill(input: { memberId: string; startDate: string; endDate: string;
  values: Map<string, number> }, database?: Database) {
  const db = database ?? await getDb();
  const fetchedAt = Date.now();
  for (let cursor = input.startDate; cursor <= input.endDate; cursor = shiftDate(cursor, 1)) {
    const activeCalories = input.values.get(cursor) ?? null;
    await db.insert(dailySourceRecords).values({ memberId: input.memberId, localDate: cursor, provider: "oura",
      status: activeCalories === null ? "not_current" : "complete", activeCalories, fetchedAt,
      sanitizedErrorCode: activeCalories === null ? OURA_ACTIVE_CALORIE_BACKFILL_MARKER : null })
      .onConflictDoUpdate({ target: [dailySourceRecords.memberId, dailySourceRecords.localDate, dailySourceRecords.provider],
        set: {
          status: sql`case when excluded.active_calories is not null then 'complete' else ${dailySourceRecords.status} end`,
          activeCalories: sql`coalesce(${dailySourceRecords.activeCalories}, excluded.active_calories)`,
          fetchedAt,
          sanitizedErrorCode: activeCalories === null ? OURA_ACTIVE_CALORIE_BACKFILL_MARKER : null,
        } });
  }
}

export type OuraHistoryCoverage = {
  completeDays: number;
  firstCompleteDate: string | null;
  lastCompleteDate: string | null;
  usableNights: {
    hrv: number;
    hrvBalance: number;
    readiness: number;
    allThree: number;
  };
};

export async function readOuraHistoryCoverage(input: { memberId: string; startDate: string; endDate: string },
  database?: Database): Promise<OuraHistoryCoverage> {
  const db = database ?? await getDb();
  const records = await db.select({ localDate: dailySourceRecords.localDate, status: dailySourceRecords.status,
    hrv: dailySourceRecords.sleepAverageHrvMs, hrvBalance: dailySourceRecords.hrvBalanceScore,
    readiness: dailySourceRecords.readinessScore }).from(dailySourceRecords).where(and(
      eq(dailySourceRecords.memberId, input.memberId), eq(dailySourceRecords.provider, "oura"),
      gte(dailySourceRecords.localDate, input.startDate), lte(dailySourceRecords.localDate, input.endDate),
    )).orderBy(asc(dailySourceRecords.localDate));
  const complete = records.filter((record) => record.status === "complete");
  return {
    completeDays: complete.length,
    firstCompleteDate: complete[0]?.localDate ?? null,
    lastCompleteDate: complete.at(-1)?.localDate ?? null,
    usableNights: {
      hrv: records.filter((record) => record.hrv !== null).length,
      hrvBalance: records.filter((record) => record.hrvBalance !== null).length,
      readiness: records.filter((record) => record.readiness !== null).length,
      allThree: records.filter((record) => record.hrv !== null && record.hrvBalance !== null &&
        record.readiness !== null).length,
    },
  };
}

export type WhoopHistoryCoverage = {
  completeDays: number;
  firstCompleteDate: string | null;
  lastCompleteDate: string | null;
  usableNights: {
    hrv: number;
    recovery: number;
    sleep: number;
    allThree: number;
  };
};

export async function readWhoopHistoryCoverage(input: { memberId: string; startDate: string; endDate: string },
  database?: Database): Promise<WhoopHistoryCoverage> {
  const db = database ?? await getDb();
  const records = await db.select({ localDate: dailySourceRecords.localDate, status: dailySourceRecords.status,
    hrv: dailySourceRecords.sleepAverageHrvMs, recovery: dailySourceRecords.recoveryScore,
    sleep: dailySourceRecords.sleepTotalSeconds }).from(dailySourceRecords).where(and(
      eq(dailySourceRecords.memberId, input.memberId), eq(dailySourceRecords.provider, "whoop"),
      gte(dailySourceRecords.localDate, input.startDate), lte(dailySourceRecords.localDate, input.endDate),
    )).orderBy(asc(dailySourceRecords.localDate));
  const complete = records.filter((record) => record.status === "complete");
  return {
    completeDays: complete.length,
    firstCompleteDate: complete[0]?.localDate ?? null,
    lastCompleteDate: complete.at(-1)?.localDate ?? null,
    usableNights: {
      hrv: records.filter((record) => record.hrv !== null).length,
      recovery: records.filter((record) => record.recovery !== null).length,
      sleep: records.filter((record) => record.sleep !== null).length,
      allThree: records.filter((record) => record.hrv !== null && record.recovery !== null &&
        record.sleep !== null).length,
    },
  };
}

export async function listSucceededOuraHistoryChunks(input: { connectionId: string; startDate: string; endDate: string },
  database?: Database): Promise<string[]> {
  const db = database ?? await getDb();
  const rows = await db.select({ localDate: syncAttempts.localDate }).from(syncAttempts).where(and(
    eq(syncAttempts.connectionId, input.connectionId), eq(syncAttempts.status, "succeeded"),
    gte(syncAttempts.localDate, input.startDate), lte(syncAttempts.localDate, input.endDate),
  )).orderBy(asc(syncAttempts.localDate));
  return [...new Set(rows.flatMap((row) => row.localDate ? [row.localDate] : []))];
}

export async function startOuraHistoryChunk(connectionId: string, localDate: string, database?: Database) {
  const db = database ?? await getDb();
  const id = crypto.randomUUID();
  await db.insert(syncAttempts).values({ id, connectionId, localDate, status: "started", startedAt: Date.now() });
  return id;
}

export async function finishOuraHistoryChunk(attemptId: string, status: "succeeded" | "failed", errorCode?: string,
  database?: Database) {
  const db = database ?? await getDb();
  await db.update(syncAttempts).set({ status, errorCode: errorCode ?? null, finishedAt: Date.now() })
    .where(eq(syncAttempts.id, attemptId));
}

export const listSucceededWhoopHistoryChunks = listSucceededOuraHistoryChunks;
export const startWhoopHistoryChunk = startOuraHistoryChunk;
export const finishWhoopHistoryChunk = finishOuraHistoryChunk;

export async function replaceSleepStages(input: { memberId: string; localDate: string;
  stages: Array<{ stage: "rem" | "light" | "deep" | "awake"; durationSeconds: number }> }, database?: Database) {
  const db = database ?? await getDb();
  await db.delete(sleepStageSegments).where(and(eq(sleepStageSegments.memberId, input.memberId),
    eq(sleepStageSegments.localDate, input.localDate), eq(sleepStageSegments.provider, "oura")));
  if (!input.stages.length) return;
  const values = input.stages.map((stage, position) => ({ id: crypto.randomUUID(), memberId: input.memberId,
    localDate: input.localDate, provider: "oura" as const, position, ...stage }));
  for (const batch of writeBatches(values, SLEEP_STAGE_INSERT_BATCH_SIZE))
    await db.insert(sleepStageSegments).values(batch);
}

export async function readHouseholdDailyData(input: { householdId: string; startDate: string; endDate: string; stageDate?: string },
  database?: Database) {
  const db = database ?? await getDb();
  const householdMembers = await db.select({ id: members.id, name: members.displayName, initials: members.initials,
    avatar: members.avatarKey, displayOrder: members.displayOrder }).from(members)
    .where(and(eq(members.householdId, input.householdId), eq(members.active, true))).orderBy(asc(members.displayOrder));
  const ids = householdMembers.map((member) => member.id);
  if (!ids.length) return { members: householdMembers, records: [], stages: [] };
  const stageDate = input.stageDate ?? input.endDate;
  const [records, stages] = await Promise.all([
    db.select().from(dailySourceRecords).where(and(inArray(dailySourceRecords.memberId, ids),
      gte(dailySourceRecords.localDate, input.startDate), lte(dailySourceRecords.localDate, input.endDate)))
      .orderBy(desc(dailySourceRecords.localDate)),
    db.select().from(sleepStageSegments).where(and(inArray(sleepStageSegments.memberId, ids),
      eq(sleepStageSegments.localDate, stageDate), eq(sleepStageSegments.provider, "oura")))
      .orderBy(asc(sleepStageSegments.position)),
  ]);
  return { members: householdMembers, records, stages };
}
