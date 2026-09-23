import { decryptProviderTokens, encryptProviderTokens } from "./provider-crypto";
import { activeCaloriesByDay, getOuraCollection, normalizeOuraDay, refreshOuraTokens } from "./providers/oura";
import { getWhoopCollection, normalizeWhoopDay, refreshWhoopTokens } from "./providers/whoop";
import { readProviderCredential, replaceProviderCredential } from "../db/provider-credential-store";
import { invalidateWellnessSnapshotCache, listHouseholdConnections, markConnectionAttempt, nextOuraActiveCaloriesBackfillDate,
  oldestIncompleteSourceDate, oldestMissingActiveCaloriesDate, replaceSleepStages, storeOuraActiveCaloriesBackfill,
  upsertDailyRecords } from "../db/wellness-store";
import { enforceRetention } from "../db/retention";
import { retentionPolicy } from "../db/retention-policy";

type Connection = Awaited<ReturnType<typeof listHouseholdConnections>>[number];
const OURA_ACTIVE_CALORIE_BACKFILL_BATCH_DAYS = 28;

function requiredConfig(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export function dateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function validAccessToken(connection: Connection) {
  const envelope = await readProviderCredential(connection.id);
  if (!envelope) throw new Error("Provider credential is missing.");
  const keyMaterial = requiredConfig("TOKEN_ENCRYPTION_KEY_V1");
  const current = await decryptProviderTokens({ connectionId: connection.id, provider: connection.provider,
    envelope, keyMaterial });
  if (envelope.expiresAt > Date.now()) return current.accessToken;

  const rotated = connection.provider === "oura"
    ? await refreshOuraTokens({ clientId: requiredConfig("OURA_CLIENT_ID"), clientSecret: requiredConfig("OURA_CLIENT_SECRET"),
        redirectUri: requiredConfig("OURA_REDIRECT_URI") }, current.refreshToken)
    : await refreshWhoopTokens({ clientId: requiredConfig("WHOOP_CLIENT_ID"), clientSecret: requiredConfig("WHOOP_CLIENT_SECRET"),
        redirectUri: requiredConfig("WHOOP_REDIRECT_URI") }, current.refreshToken);
  const encrypted = await encryptProviderTokens({ connectionId: connection.id, provider: connection.provider,
    tokens: rotated, expiresAt: rotated.expiresAt, keyVersion: 1, keyMaterial });
  await replaceProviderCredential(connection.id, encrypted);
  return rotated.accessToken;
}

async function syncOura(connection: Connection, date: string, lookbackDays: number) {
  const accessToken = await validAccessToken(connection);
  const startDate = shiftDate(date, -lookbackDays);
  const stageStartDate = shiftDate(date, -6);
  const [activities, readiness, sleeps] = await Promise.all([
    getOuraCollection("daily_activity", accessToken, startDate, date),
    getOuraCollection("daily_readiness", accessToken, startDate, date),
    getOuraCollection("sleep", accessToken, startDate, date),
  ]);
  const records = [];
  for (let cursor = startDate; cursor <= date; cursor = shiftDate(cursor, 1)) {
    const normalized = normalizeOuraDay({ date: cursor, activities, readiness, sleeps });
    const persisted = normalized.status === "complete" ? {
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
    records.push({ memberId: connection.memberId, localDate: cursor, provider: "oura" as const,
      status: normalized.status, ...persisted, fetchedAt: Date.now() });
    if (normalized.status === "complete" && cursor >= stageStartDate)
      await replaceSleepStages({ memberId: connection.memberId, localDate: cursor, stages: normalized.sleepStages });
  }
  await upsertDailyRecords(records);
}

async function syncWhoop(connection: Connection, date: string, lookbackDays: number) {
  const accessToken = await validAccessToken(connection);
  const startDate = shiftDate(date, -lookbackDays);
  const start = `${shiftDate(startDate, -1)}T00:00:00.000Z`;
  const [cycles, recoveries, sleeps] = await Promise.all([
    getWhoopCollection("cycles", accessToken, start, null),
    getWhoopCollection("recovery", accessToken, start, null),
    getWhoopCollection("sleep", accessToken, start, null),
  ]);
  const records = [];
  for (let cursor = startDate; cursor <= date; cursor = shiftDate(cursor, 1)) {
    const normalized = normalizeWhoopDay({ date: cursor, cycles, recoveries, sleeps });
    const persisted = normalized.status === "complete" ? {
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
    records.push({ memberId: connection.memberId, localDate: cursor, provider: "whoop" as const,
      status: normalized.status, ...persisted, fetchedAt: Date.now() });
  }
  await upsertDailyRecords(records);
}

function errorCode(error: unknown): "authorization_required" | "provider_unavailable" {
  return error instanceof Error && /HTTP 401|credential|decrypt|refresh/i.test(error.message)
    ? "authorization_required" : "provider_unavailable";
}

function diagnosticCode(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const httpStatus = /HTTP (\d{3})/.exec(error.message)?.[1];
  if (httpStatus) return `http_${httpStatus}`;
  if (/pagination token/i.test(error.message)) return "pagination";
  if (/malformed JSON|response was invalid|omitted records|record was invalid/i.test(error.message)) return "response_shape";
  if (/Failed query/i.test(error.message)) return "storage_write";
  return "unexpected";
}

function elapsedDays(startDate: string, endDate: string): number {
  return Math.round((Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) /
    (24 * 60 * 60 * 1000));
}

async function lookbackDays(connection: Connection, date: string, now: Date): Promise<number> {
  if (connection.lastSuccessAt === null) return 29;
  const daysSinceSuccess = Math.ceil((now.valueOf() - connection.lastSuccessAt) / (24 * 60 * 60 * 1000));
  const normalLookback = Math.min(29, Math.max(2, daysSinceSuccess + 1));
  const incompleteDate = await oldestIncompleteSourceDate({ memberId: connection.memberId,
    provider: connection.provider, startDate: shiftDate(date, -14), endDate: date });
  const missingActiveDate = connection.provider === "oura"
    ? await oldestMissingActiveCaloriesDate(connection.memberId, shiftDate(date, -27), date) : null;
  return Math.max(normalLookback, incompleteDate ? elapsedDays(incompleteDate, date) : 0,
    missingActiveDate ? elapsedDays(missingActiveDate, date) : 0);
}

async function syncConnection(connection: Connection, date: string, now: Date) {
  try {
    const days = await lookbackDays(connection, date, now);
    if (connection.provider === "oura") await syncOura(connection, date, days);
    else await syncWhoop(connection, date, days);
    await markConnectionAttempt(connection.id, "connected", true);
  } catch (error) {
    const code = errorCode(error);
    console.error("Provider sync failed", { provider: connection.provider, code, diagnostic: diagnosticCode(error) });
    await upsertDailyRecords([{ memberId: connection.memberId, localDate: date, provider: connection.provider,
      status: "unavailable", fetchedAt: Date.now(), sanitizedErrorCode: code }]);
    await markConnectionAttempt(connection.id, code === "authorization_required" ? "action_required" : "connected", false);
  }
}

async function backfillOuraActiveCalories(connection: Connection, date: string) {
  const historyStart = shiftDate(date, -retentionPolicy.normalizedDailyMetricsDays);
  const batchStart = await nextOuraActiveCaloriesBackfillDate(connection.memberId, historyStart, date);
  if (!batchStart) return { changed: false, completedNow: false };
  const proposedEnd = shiftDate(batchStart, OURA_ACTIVE_CALORIE_BACKFILL_BATCH_DAYS - 1);
  const batchEnd = proposedEnd < date ? proposedEnd : date;
  const accessToken = await validAccessToken(connection);
  const activities = await getOuraCollection("daily_activity", accessToken, batchStart, batchEnd);
  const values = activeCaloriesByDay(activities);
  await storeOuraActiveCaloriesBackfill({ memberId: connection.memberId, startDate: batchStart, endDate: batchEnd, values });
  return { changed: values.size > 0, completedNow: batchEnd === date };
}

export async function syncHousehold(householdId: string, timezone: string, now = new Date()) {
  const date = dateInTimezone(now, timezone);
  const connections = await listHouseholdConnections(householdId);
  const recentThreshold = now.valueOf() - 5 * 60 * 1000;
  const activeConnections = connections.filter((item) => item.status !== "disconnected");
  await Promise.all(activeConnections.filter((item) => item.lastSuccessAt === null || item.lastSuccessAt < recentThreshold)
    .map((connection) => syncConnection(connection, date, now)));
  const backfillResults = await Promise.all(activeConnections.filter((item) => item.provider === "oura").map(async (connection) => {
    try {
      return await backfillOuraActiveCalories(connection, date);
    } catch (error) {
      console.error("Oura active calorie backfill failed", { diagnostic: diagnosticCode(error) });
      return { changed: false, completedNow: false };
    }
  }));
  if (backfillResults.some((result) => result.changed || result.completedNow))
    await invalidateWellnessSnapshotCache(householdId);
  await enforceRetention(date, now.valueOf());
  return date;
}
