import { getOuraCollection, normalizeOuraDay } from "./providers/oura";
import { validAccessToken } from "./provider-sync";
import { HISTORY_BACKFILL_CHUNK_DAYS, HISTORY_BACKFILL_DAYS, HistoryBackfillRangeError,
  historyBackfillRange, historyChunkStarts, shiftHistoryDate, type HistoryBackfillRange } from
  "./history-backfill-range";
import { invalidateWellnessSnapshotCache, listHouseholdConnections, listSucceededOuraHistoryChunks,
  readOuraHistoryCoverage, startOuraHistoryChunk, finishOuraHistoryChunk, upsertDailyRecords,
  type OuraHistoryCoverage } from "../db/wellness-store";
export const OURA_HISTORY_BACKFILL_DAYS = HISTORY_BACKFILL_DAYS;
export const OURA_HISTORY_BACKFILL_CHUNK_DAYS = HISTORY_BACKFILL_CHUNK_DAYS;

type Connection = Awaited<ReturnType<typeof listHouseholdConnections>>[number];
type OuraResource = "daily_activity" | "daily_readiness" | "sleep";
type OuraRecord = Record<string, unknown>;

export class OuraHistoryBackfillError extends Error {
  constructor(public readonly code: "invalid_end_date" | "oura_connection_required" | "backfill_failed",
    public readonly retryStartDate: string | null = null) {
    super(code);
  }
}

export type OuraHistoryRange = HistoryBackfillRange;

export type OuraHistoryBackfillStatus = {
  requestedRange: OuraHistoryRange;
  progress: { completedChunks: number; totalChunks: number; nextStartDate: string | null; complete: boolean };
  coverage: OuraHistoryCoverage;
};

export type OuraReturnedCoverage = {
  firstDate: string | null;
  lastDate: string | null;
  returnedDays: number;
  resourceDays: { readiness: number; sleep: number; activity: number };
  usableNights: { hrv: number; hrvBalance: number; readiness: number; allThree: number };
};

export type OuraHistoryBackfillChunkResult = OuraHistoryBackfillStatus & {
  processedRange: { startDate: string; endDate: string } | null;
  returnedCoverage: OuraReturnedCoverage | null;
  coverageBefore: OuraHistoryCoverage;
};

type Dependencies = {
  listConnections: (householdId: string) => Promise<Connection[]>;
  accessToken: (connection: Connection) => Promise<string>;
  collection: (resource: OuraResource, accessToken: string, startDate: string, endDate: string) => Promise<OuraRecord[]>;
  coverage: (memberId: string, startDate: string, endDate: string) => Promise<OuraHistoryCoverage>;
  succeededChunks: (connectionId: string, startDate: string, endDate: string) => Promise<string[]>;
  startAttempt: (connectionId: string, localDate: string) => Promise<string>;
  finishAttempt: (attemptId: string, status: "succeeded" | "failed", errorCode?: string) => Promise<void>;
  upsert: (records: Parameters<typeof upsertDailyRecords>[0]) => Promise<void>;
  invalidateCache: (householdId: string) => Promise<void>;
};

const defaultDependencies: Dependencies = {
  listConnections: listHouseholdConnections,
  accessToken: validAccessToken,
  collection: getOuraCollection,
  coverage: (memberId, startDate, endDate) => readOuraHistoryCoverage({ memberId, startDate, endDate }),
  succeededChunks: (connectionId, startDate, endDate) =>
    listSucceededOuraHistoryChunks({ connectionId, startDate, endDate }),
  startAttempt: startOuraHistoryChunk,
  finishAttempt: finishOuraHistoryChunk,
  upsert: upsertDailyRecords,
  invalidateCache: invalidateWellnessSnapshotCache,
};

export function shiftOuraHistoryDate(date: string, days: number): string {
  try { return shiftHistoryDate(date, days); }
  catch (error) {
    if (error instanceof HistoryBackfillRangeError) throw new OuraHistoryBackfillError("invalid_end_date");
    throw error;
  }
}

export function ouraHistoryRange(now: Date, timezone: string, requestedEndDate?: string): OuraHistoryRange {
  try { return historyBackfillRange(now, timezone, requestedEndDate); }
  catch (error) {
    if (error instanceof HistoryBackfillRangeError) throw new OuraHistoryBackfillError("invalid_end_date");
    throw error;
  }
}

function connectionFor(connections: Connection[], memberId: string): Connection {
  const connection = connections.find((item) => item.memberId === memberId && item.provider === "oura" &&
    item.status !== "disconnected");
  if (!connection) throw new OuraHistoryBackfillError("oura_connection_required");
  return connection;
}

async function statusFor(input: { householdId: string; memberId: string; timezone: string; now: Date;
  endDate?: string }, dependencies: Dependencies) {
  const range = ouraHistoryRange(input.now, input.timezone, input.endDate);
  const connection = connectionFor(await dependencies.listConnections(input.householdId), input.memberId);
  const [coverage, succeeded] = await Promise.all([
    dependencies.coverage(input.memberId, range.startDate, range.endDate),
    dependencies.succeededChunks(connection.id, range.startDate, range.endDate),
  ]);
  const starts = historyChunkStarts(range);
  const completed = new Set(succeeded);
  const nextStartDate = starts.find((date) => !completed.has(date)) ?? null;
  return { connection, status: { requestedRange: range, progress: { completedChunks: starts.length -
    starts.filter((date) => !completed.has(date)).length, totalChunks: starts.length, nextStartDate,
  complete: nextStartDate === null }, coverage } satisfies OuraHistoryBackfillStatus };
}

export async function getOuraHistoryBackfillStatus(input: { householdId: string; memberId: string; timezone: string;
  now?: Date; endDate?: string }, dependencies: Dependencies = defaultDependencies): Promise<OuraHistoryBackfillStatus> {
  return (await statusFor({ ...input, now: input.now ?? new Date() }, dependencies)).status;
}

function persistedRecord(memberId: string, date: string, normalized: ReturnType<typeof normalizeOuraDay>, fetchedAt: number) {
  const metrics = normalized.status === "complete" ? {
    readinessScore: normalized.readinessScore,
    hrvBalanceScore: normalized.hrvBalanceScore,
    restingHeartRateContributorScore: normalized.restingHeartRateContributorScore,
    sleepBalanceScore: normalized.sleepBalanceScore,
    bodyTemperatureContributorScore: normalized.bodyTemperatureContributorScore,
    bodyTemperatureDeviationC: normalized.bodyTemperatureDeviationC,
    previousDayActivityScore: normalized.previousDayActivityScore,
    totalCalories: normalized.totalCalories,
    activeCalories: normalized.activeCalories,
    sleepAverageHeartRateBpm: normalized.sleepAverageHeartRateBpm,
    sleepAverageHrvMs: normalized.sleepAverageHrvMs,
    respiratoryRate: normalized.respiratoryRate,
    sleepTotalSeconds: normalized.sleepTotalSeconds,
    deepSleepSeconds: normalized.deepSleepSeconds,
    sleepStartAt: normalized.sleepStartAt,
    sleepEndAt: normalized.sleepEndAt,
    sourceUpdatedAt: normalized.sourceUpdatedAt,
  } : {};
  return { memberId, localDate: date, provider: "oura" as const, status: normalized.status, ...metrics, fetchedAt };
}

function returnedCoverage(input: { startDate: string; endDate: string; activities: OuraRecord[];
  readiness: OuraRecord[]; sleeps: OuraRecord[] }): OuraReturnedCoverage {
  const datesFor = (records: OuraRecord[]) => new Set(records.flatMap((record) =>
    typeof record.day === "string" && record.day >= input.startDate && record.day <= input.endDate ? [record.day] : []));
  const activityDates = datesFor(input.activities);
  const readinessDates = datesFor(input.readiness);
  const sleepDates = datesFor(input.sleeps);
  const dates = [...new Set([...activityDates, ...readinessDates, ...sleepDates])].sort();
  const normalized = dates.map((date) => normalizeOuraDay({ date, activities: input.activities,
    readiness: input.readiness, sleeps: input.sleeps }));
  return {
    firstDate: dates[0] ?? null,
    lastDate: dates.at(-1) ?? null,
    returnedDays: dates.length,
    resourceDays: { readiness: readinessDates.size, sleep: sleepDates.size, activity: activityDates.size },
    usableNights: {
      hrv: normalized.filter((item) => item.status === "complete" && item.sleepAverageHrvMs !== null).length,
      hrvBalance: normalized.filter((item) => item.status === "complete" && item.hrvBalanceScore !== null).length,
      readiness: normalized.filter((item) => item.status === "complete" && item.readinessScore !== null).length,
      allThree: normalized.filter((item) => item.status === "complete" && item.sleepAverageHrvMs !== null &&
        item.hrvBalanceScore !== null && item.readinessScore !== null).length,
    },
  };
}

function safeDiagnosticCode(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const status = /HTTP (\d{3})/.exec(error.message)?.[1];
  if (status) return `http_${status}`;
  if (/pagination/i.test(error.message)) return "pagination";
  if (/credential|decrypt|refresh/i.test(error.message)) return "authorization";
  if (/storage|query/i.test(error.message)) return "storage";
  return "unexpected";
}

export async function runOuraHistoryBackfillChunk(input: { householdId: string; memberId: string; timezone: string;
  now?: Date; endDate?: string }, dependencies: Dependencies = defaultDependencies): Promise<OuraHistoryBackfillChunkResult> {
  const now = input.now ?? new Date();
  const before = await statusFor({ ...input, now }, dependencies);
  const nextStartDate = before.status.progress.nextStartDate;
  if (!nextStartDate) return { ...before.status, processedRange: null, returnedCoverage: null,
    coverageBefore: before.status.coverage };
  const proposedEnd = shiftOuraHistoryDate(nextStartDate, OURA_HISTORY_BACKFILL_CHUNK_DAYS - 1);
  const chunkEndDate = proposedEnd < before.status.requestedRange.endDate ? proposedEnd :
    before.status.requestedRange.endDate;
  const attemptId = await dependencies.startAttempt(before.connection.id, nextStartDate);
  try {
    const accessToken = await dependencies.accessToken(before.connection);
    const [activities, readiness, sleeps] = await Promise.all([
      dependencies.collection("daily_activity", accessToken, nextStartDate, chunkEndDate),
      dependencies.collection("daily_readiness", accessToken, nextStartDate, chunkEndDate),
      dependencies.collection("sleep", accessToken, nextStartDate, chunkEndDate),
    ]);
    const fetchedAt = now.valueOf();
    const records = [];
    for (let cursor = nextStartDate; cursor <= chunkEndDate; cursor = shiftOuraHistoryDate(cursor, 1)) {
      records.push(persistedRecord(input.memberId, cursor, normalizeOuraDay({ date: cursor, activities,
        readiness, sleeps }), fetchedAt));
    }
    await dependencies.upsert(records);
    await dependencies.finishAttempt(attemptId, "succeeded");
    await dependencies.invalidateCache(input.householdId);
    const after = await statusFor({ ...input, now }, dependencies);
    return { ...after.status, processedRange: { startDate: nextStartDate, endDate: chunkEndDate },
      returnedCoverage: returnedCoverage({ startDate: nextStartDate, endDate: chunkEndDate, activities, readiness, sleeps }),
      coverageBefore: before.status.coverage };
  } catch (error) {
    const diagnostic = safeDiagnosticCode(error);
    try { await dependencies.finishAttempt(attemptId, "failed", diagnostic); } catch { /* Preserve the original failure. */ }
    throw new OuraHistoryBackfillError("backfill_failed", nextStartDate);
  }
}
