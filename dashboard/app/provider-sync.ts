import { decryptProviderTokens, encryptProviderTokens } from "./provider-crypto";
import { getOuraCollection, normalizeOuraDay, refreshOuraTokens } from "./providers/oura";
import { getWhoopCollection, normalizeWhoopDay, refreshWhoopTokens } from "./providers/whoop";
import { readProviderCredential, replaceProviderCredential } from "../db/provider-credential-store";
import { listHouseholdConnections, markConnectionAttempt, replaceSleepStages, upsertDailyRecords } from "../db/wellness-store";
import { enforceRetention } from "../db/retention";

type Connection = Awaited<ReturnType<typeof listHouseholdConnections>>[number];

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

async function syncOura(connection: Connection, date: string) {
  const accessToken = await validAccessToken(connection);
  const startDate = shiftDate(date, -29);
  const [readiness, sleeps] = await Promise.all([
    getOuraCollection("daily_readiness", accessToken, startDate, date),
    getOuraCollection("sleep", accessToken, startDate, date),
  ]);
  const records = [];
  for (let cursor = startDate; cursor <= date; cursor = shiftDate(cursor, 1)) {
    const normalized = normalizeOuraDay({ date: cursor, readiness, sleeps });
    const persisted = normalized.status === "complete" ? {
      readinessScore: normalized.readinessScore,
      hrvBalanceScore: normalized.hrvBalanceScore,
      restingHeartRateContributorScore: normalized.restingHeartRateContributorScore,
      sleepBalanceScore: normalized.sleepBalanceScore,
      bodyTemperatureContributorScore: normalized.bodyTemperatureContributorScore,
      previousDayActivityScore: normalized.previousDayActivityScore,
      sleepAverageHeartRateBpm: normalized.sleepAverageHeartRateBpm,
      sleepAverageHrvMs: normalized.sleepAverageHrvMs,
      sleepTotalSeconds: normalized.sleepTotalSeconds,
      deepSleepSeconds: normalized.deepSleepSeconds,
      sleepStartAt: normalized.sleepStartAt,
      sleepEndAt: normalized.sleepEndAt,
      sourceUpdatedAt: normalized.sourceUpdatedAt,
    } : {};
    records.push({ memberId: connection.memberId, localDate: cursor, provider: "oura" as const,
      status: normalized.status, ...persisted, fetchedAt: Date.now() });
    if (normalized.status === "complete" && cursor === date)
      await replaceSleepStages({ memberId: connection.memberId, localDate: date, stages: normalized.sleepStages });
  }
  await upsertDailyRecords(records);
}

async function syncWhoop(connection: Connection, date: string) {
  const accessToken = await validAccessToken(connection);
  const start = `${shiftDate(date, -1)}T00:00:00.000Z`;
  const end = `${shiftDate(date, 2)}T00:00:00.000Z`;
  const [cycles, recoveries, sleeps] = await Promise.all([
    getWhoopCollection("cycles", accessToken, start, end),
    getWhoopCollection("recovery", accessToken, start, end),
    getWhoopCollection("sleep", accessToken, start, end),
  ]);
  const normalized = normalizeWhoopDay({ date, cycles, recoveries, sleeps });
  await upsertDailyRecords([{ memberId: connection.memberId, localDate: date, provider: "whoop",
    status: normalized.status, ...(normalized.status === "complete" ? normalized : {}), fetchedAt: Date.now() }]);
}

function errorCode(error: unknown): "authorization_required" | "provider_unavailable" {
  return error instanceof Error && /HTTP 401|credential|decrypt|refresh/i.test(error.message)
    ? "authorization_required" : "provider_unavailable";
}

async function syncConnection(connection: Connection, date: string) {
  try {
    if (connection.provider === "oura") await syncOura(connection, date);
    else await syncWhoop(connection, date);
    await markConnectionAttempt(connection.id, "connected", true);
  } catch (error) {
    const code = errorCode(error);
    await upsertDailyRecords([{ memberId: connection.memberId, localDate: date, provider: connection.provider,
      status: "unavailable", fetchedAt: Date.now(), sanitizedErrorCode: code }]);
    await markConnectionAttempt(connection.id, code === "authorization_required" ? "action_required" : "connected", false);
  }
}

export async function syncHousehold(householdId: string, timezone: string, now = new Date()) {
  const date = dateInTimezone(now, timezone);
  const connections = await listHouseholdConnections(householdId);
  await Promise.all(connections.filter((item) => item.status !== "disconnected")
    .map((connection) => syncConnection(connection, date)));
  await enforceRetention(date, now.valueOf());
  return date;
}
