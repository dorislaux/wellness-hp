import { HISTORY_BACKFILL_CHUNK_DAYS, HistoryBackfillRangeError, historyBackfillRange,
  historyChunkStarts, shiftHistoryDate, type HistoryBackfillRange } from "./history-backfill-range";
import { validAccessToken } from "./provider-sync";
import { getWhoopCollection, normalizeWhoopDay } from "./providers/whoop";
import { finishWhoopHistoryChunk, invalidateWellnessSnapshotCache, listHouseholdConnections,
  listSucceededWhoopHistoryChunks, readWhoopHistoryCoverage, startWhoopHistoryChunk,
  upsertDailyRecords, type WhoopHistoryCoverage } from "../db/wellness-store";

type Connection = Awaited<ReturnType<typeof listHouseholdConnections>>[number];
type WhoopResource = "cycles" | "recovery" | "sleep";
type WhoopRecord = Record<string, unknown>;

export class WhoopHistoryBackfillError extends Error {
  constructor(public readonly code: "invalid_end_date" | "whoop_connection_required" | "backfill_failed",
    public readonly retryStartDate: string | null = null) {
    super(code);
  }
}

export type WhoopHistoryBackfillStatus = {
  requestedRange: HistoryBackfillRange;
  progress: { completedChunks: number; totalChunks: number; nextStartDate: string | null; complete: boolean };
  coverage: WhoopHistoryCoverage;
};

export type WhoopReturnedCoverage = {
  firstDate: string | null;
  lastDate: string | null;
  returnedDays: number;
  resourceRecords: { cycles: number; recovery: number; sleep: number };
  usableNights: { hrv: number; recovery: number; sleep: number; allThree: number };
};

export type WhoopHistoryBackfillChunkResult = WhoopHistoryBackfillStatus & {
  processedRange: { startDate: string; endDate: string } | null;
  returnedCoverage: WhoopReturnedCoverage | null;
  coverageBefore: WhoopHistoryCoverage;
};

type Dependencies = {
  listConnections: (householdId: string) => Promise<Connection[]>;
  accessToken: (connection: Connection) => Promise<string>;
  collection: (resource: WhoopResource, accessToken: string, start: string,
    end: string | null) => Promise<WhoopRecord[]>;
  coverage: (memberId: string, startDate: string, endDate: string) => Promise<WhoopHistoryCoverage>;
  succeededChunks: (connectionId: string, startDate: string, endDate: string) => Promise<string[]>;
  startAttempt: (connectionId: string, localDate: string) => Promise<string>;
  finishAttempt: (attemptId: string, status: "succeeded" | "failed", errorCode?: string) => Promise<void>;
  upsert: (records: Parameters<typeof upsertDailyRecords>[0]) => Promise<void>;
  invalidateCache: (householdId: string) => Promise<void>;
};

const defaultDependencies: Dependencies = {
  listConnections: listHouseholdConnections,
  accessToken: validAccessToken,
  collection: getWhoopCollection,
  coverage: (memberId, startDate, endDate) => readWhoopHistoryCoverage({ memberId, startDate, endDate }),
  succeededChunks: (connectionId, startDate, endDate) =>
    listSucceededWhoopHistoryChunks({ connectionId, startDate, endDate }),
  startAttempt: startWhoopHistoryChunk,
  finishAttempt: finishWhoopHistoryChunk,
  upsert: upsertDailyRecords,
  invalidateCache: invalidateWellnessSnapshotCache,
};

function rangeFor(now: Date, timezone: string, endDate?: string) {
  try { return historyBackfillRange(now, timezone, endDate); }
  catch (error) {
    if (error instanceof HistoryBackfillRangeError) throw new WhoopHistoryBackfillError("invalid_end_date");
    throw error;
  }
}

function connectionFor(connections: Connection[], memberId: string): Connection {
  const connection = connections.find((item) => item.memberId === memberId && item.provider === "whoop" &&
    item.status !== "disconnected");
  if (!connection) throw new WhoopHistoryBackfillError("whoop_connection_required");
  return connection;
}

async function statusFor(input: { householdId: string; memberId: string; timezone: string; now: Date;
  endDate?: string }, dependencies: Dependencies) {
  const range = rangeFor(input.now, input.timezone, input.endDate);
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
  complete: nextStartDate === null }, coverage } satisfies WhoopHistoryBackfillStatus };
}

export async function getWhoopHistoryBackfillStatus(input: { householdId: string; memberId: string;
  timezone: string; now?: Date; endDate?: string },
dependencies: Dependencies = defaultDependencies): Promise<WhoopHistoryBackfillStatus> {
  return (await statusFor({ ...input, now: input.now ?? new Date() }, dependencies)).status;
}

function persistedRecord(memberId: string, date: string, normalized: ReturnType<typeof normalizeWhoopDay>,
  fetchedAt: number) {
  const metrics = normalized.status === "complete" ? {
    recoveryScore: normalized.recoveryScore,
    sleepAverageHrvMs: normalized.sleepAverageHrvMs,
    sleepAverageHeartRateBpm: normalized.sleepAverageHeartRateBpm,
    skinTemperatureC: normalized.skinTemperatureC,
    dayStrain: normalized.dayStrain,
    totalCalories: normalized.totalCalories,
    sleepTotalSeconds: normalized.sleepTotalSeconds,
    deepSleepSeconds: normalized.deepSleepSeconds,
    sleepStartAt: normalized.sleepStartAt,
    sleepEndAt: normalized.sleepEndAt,
    respiratoryRate: normalized.respiratoryRate,
    sourceUpdatedAt: normalized.sourceUpdatedAt,
  } : {};
  return { memberId, localDate: date, provider: "whoop" as const, status: normalized.status,
    ...metrics, fetchedAt };
}

function returnedCoverage(input: { startDate: string; endDate: string; cycles: WhoopRecord[];
  recoveries: WhoopRecord[]; sleeps: WhoopRecord[] }): WhoopReturnedCoverage {
  const normalized = [];
  for (let cursor = input.startDate; cursor <= input.endDate; cursor = shiftHistoryDate(cursor, 1))
    normalized.push({ date: cursor, value: normalizeWhoopDay({ date: cursor, cycles: input.cycles,
      recoveries: input.recoveries, sleeps: input.sleeps }) });
  const returned = normalized.filter((item) => item.value.status === "complete");
  return {
    firstDate: returned[0]?.date ?? null,
    lastDate: returned.at(-1)?.date ?? null,
    returnedDays: returned.length,
    resourceRecords: { cycles: input.cycles.length, recovery: input.recoveries.length,
      sleep: input.sleeps.length },
    usableNights: {
      hrv: returned.filter((item) => item.value.status === "complete" &&
        item.value.sleepAverageHrvMs !== null).length,
      recovery: returned.filter((item) => item.value.status === "complete" &&
        item.value.recoveryScore !== null).length,
      sleep: returned.filter((item) => item.value.status === "complete" &&
        item.value.sleepTotalSeconds !== null).length,
      allThree: returned.filter((item) => item.value.status === "complete" &&
        item.value.sleepAverageHrvMs !== null && item.value.recoveryScore !== null &&
        item.value.sleepTotalSeconds !== null).length,
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

export async function runWhoopHistoryBackfillChunk(input: { householdId: string; memberId: string;
  timezone: string; now?: Date; endDate?: string },
dependencies: Dependencies = defaultDependencies): Promise<WhoopHistoryBackfillChunkResult> {
  const now = input.now ?? new Date();
  const before = await statusFor({ ...input, now }, dependencies);
  const nextStartDate = before.status.progress.nextStartDate;
  if (!nextStartDate) return { ...before.status, processedRange: null, returnedCoverage: null,
    coverageBefore: before.status.coverage };
  const proposedEnd = shiftHistoryDate(nextStartDate, HISTORY_BACKFILL_CHUNK_DAYS - 1);
  const chunkEndDate = proposedEnd < before.status.requestedRange.endDate ? proposedEnd :
    before.status.requestedRange.endDate;
  const attemptId = await dependencies.startAttempt(before.connection.id, nextStartDate);
  try {
    const accessToken = await dependencies.accessToken(before.connection);
    // WHOOP indexes records by event timestamps. Padding keeps overnight sleeps crossing a
    // calendar boundary available while writes remain strictly inside the requested dates.
    const queryStart = `${shiftHistoryDate(nextStartDate, -2)}T00:00:00.000Z`;
    const queryEnd = `${shiftHistoryDate(chunkEndDate, 2)}T23:59:59.999Z`;
    const [cycles, recoveries, sleeps] = await Promise.all([
      dependencies.collection("cycles", accessToken, queryStart, queryEnd),
      dependencies.collection("recovery", accessToken, queryStart, queryEnd),
      dependencies.collection("sleep", accessToken, queryStart, queryEnd),
    ]);
    const records = [];
    for (let cursor = nextStartDate; cursor <= chunkEndDate; cursor = shiftHistoryDate(cursor, 1))
      records.push(persistedRecord(input.memberId, cursor, normalizeWhoopDay({ date: cursor, cycles,
        recoveries, sleeps }), now.valueOf()));
    await dependencies.upsert(records);
    await dependencies.finishAttempt(attemptId, "succeeded");
    await dependencies.invalidateCache(input.householdId);
    const after = await statusFor({ ...input, now }, dependencies);
    return { ...after.status, processedRange: { startDate: nextStartDate, endDate: chunkEndDate },
      returnedCoverage: returnedCoverage({ startDate: nextStartDate, endDate: chunkEndDate, cycles,
        recoveries, sleeps }), coverageBefore: before.status.coverage };
  } catch (error) {
    const diagnostic = safeDiagnosticCode(error);
    try { await dependencies.finishAttempt(attemptId, "failed", diagnostic); }
    catch { /* Preserve the original failure. */ }
    throw new WhoopHistoryBackfillError("backfill_failed", nextStartDate);
  }
}
