import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, type Database } from "./index";
import { dailySourceRecords, members, providerConnections, sleepStageSegments, wellnessSnapshotCache } from "./schema";
import { writeBatches } from "./write-batches";

export type DailyRecordInput = typeof dailySourceRecords.$inferInsert;
export type SleepStageInput = typeof sleepStageSegments.$inferInsert;
const SLEEP_STAGE_INSERT_BATCH_SIZE = 12;
const SNAPSHOT_SCHEMA_VERSION = 1;

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
