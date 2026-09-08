import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, type Database } from "./index";
import { dailySourceRecords, members, providerConnections, sleepStageSegments } from "./schema";
import { writeBatches } from "./write-batches";

export type DailyRecordInput = typeof dailySourceRecords.$inferInsert;
export type SleepStageInput = typeof sleepStageSegments.$inferInsert;
const SLEEP_STAGE_INSERT_BATCH_SIZE = 12;

export async function listHouseholdConnections(householdId: string, database?: Database) {
  const db = database ?? await getDb();
  return db.select({ id: providerConnections.id, memberId: providerConnections.memberId,
    provider: providerConnections.provider, status: providerConnections.status,
    grantedScopes: providerConnections.grantedScopes })
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
    await db.insert(dailySourceRecords).values(item).onConflictDoUpdate({
      target: [dailySourceRecords.memberId, dailySourceRecords.localDate, dailySourceRecords.provider],
      set: { status: item.status, readinessScore: item.readinessScore ?? null,
        hrvBalanceScore: item.hrvBalanceScore ?? null,
        restingHeartRateContributorScore: item.restingHeartRateContributorScore ?? null,
        sleepBalanceScore: item.sleepBalanceScore ?? null,
        bodyTemperatureContributorScore: item.bodyTemperatureContributorScore ?? null,
        previousDayActivityScore: item.previousDayActivityScore ?? null,
        totalCalories: item.totalCalories ?? null,
        sleepAverageHeartRateBpm: item.sleepAverageHeartRateBpm ?? null,
        sleepAverageHrvMs: item.sleepAverageHrvMs ?? null,
        sleepTotalSeconds: item.sleepTotalSeconds ?? null, deepSleepSeconds: item.deepSleepSeconds ?? null,
        sleepStartAt: item.sleepStartAt ?? null, sleepEndAt: item.sleepEndAt ?? null,
        recoveryScore: item.recoveryScore ?? null, dayStrain: item.dayStrain ?? null,
        sourceUpdatedAt: item.sourceUpdatedAt ?? null, fetchedAt: item.fetchedAt ?? Date.now(),
        sanitizedErrorCode: item.sanitizedErrorCode ?? null },
    });
  }
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
  const records = await db.select().from(dailySourceRecords).where(and(inArray(dailySourceRecords.memberId, ids),
    gte(dailySourceRecords.localDate, input.startDate), lte(dailySourceRecords.localDate, input.endDate)))
    .orderBy(desc(dailySourceRecords.localDate));
  const stageDate = input.stageDate ?? input.endDate;
  const stages = await db.select().from(sleepStageSegments).where(and(inArray(sleepStageSegments.memberId, ids),
    eq(sleepStageSegments.localDate, stageDate), eq(sleepStageSegments.provider, "oura")))
    .orderBy(asc(sleepStageSegments.position));
  return { members: householdMembers, records, stages };
}
