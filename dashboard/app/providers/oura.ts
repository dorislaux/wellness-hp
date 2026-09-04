import type { ProviderTokenSecret } from "../provider-crypto";

export const OURA_SCOPES = "daily personal";
const AUTHORIZATION_URL = "https://cloud.ouraring.com/oauth/authorize";
const TOKEN_URL = "https://api.ouraring.com/oauth/token";
const API_BASE_URL = "https://api.ouraring.com/v2/usercollection";
const MAX_RESPONSE_BYTES = 5_000_000;

export type OuraConfig = { clientId: string; clientSecret: string; redirectUri: string };
export type OuraTokenSet = ProviderTokenSecret & { expiresAt: number; grantedScopes: string };
type Fetch = typeof fetch;
type JsonRecord = Record<string, unknown>;

function record(value: unknown, message: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as JsonRecord;
}
function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value) throw new Error(message);
  return value;
}
function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function validateOuraConfig(config: OuraConfig): OuraConfig {
  if (!config.clientId || !config.clientSecret) throw new Error("Oura configuration is incomplete.");
  const redirect = new URL(config.redirectUri);
  if (redirect.protocol !== "https:" || redirect.username || redirect.password || redirect.hash) {
    throw new Error("Oura redirect URI must be a safe HTTPS URL.");
  }
  return config;
}

export function buildOuraAuthorizationUrl(config: OuraConfig, state: string): string {
  validateOuraConfig(config);
  if (state.length < 8) throw new Error("Oura authorization state is invalid.");
  const url = new URL(AUTHORIZATION_URL);
  url.search = new URLSearchParams({ response_type: "code", client_id: config.clientId,
    redirect_uri: config.redirectUri, scope: OURA_SCOPES, state }).toString();
  return url.toString();
}

async function boundedJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_RESPONSE_BYTES) throw new Error("Oura response exceeded the size limit.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error("Oura response exceeded the size limit.");
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("Oura returned malformed JSON."); }
}

function parseTokenResponse(payload: unknown, now: number): OuraTokenSet {
  const body = record(payload, "Oura token response was invalid.");
  const accessToken = requiredString(body.access_token, "Oura token response omitted the access token.");
  const refreshToken = requiredString(body.refresh_token, "Oura token response omitted the refresh token.");
  if (typeof body.token_type !== "string" || body.token_type.toLowerCase() !== "bearer")
    throw new Error("Oura returned an unsupported token type.");
  if (typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 60)
    throw new Error("Oura returned an invalid token expiry.");
  return { accessToken, refreshToken, grantedScopes: typeof body.scope === "string" ? body.scope : "",
    expiresAt: now + body.expires_in * 1000 - 60_000 };
}

async function requestTokens(config: OuraConfig, fields: Record<string, string>, fetchImpl: Fetch, now: number) {
  validateOuraConfig(config);
  const response = await fetchImpl(TOKEN_URL, { method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, client_id: config.clientId, client_secret: config.clientSecret }) });
  const payload = await boundedJson(response);
  if (!response.ok) throw new Error(`Oura token request failed with HTTP ${response.status}.`);
  return parseTokenResponse(payload, now);
}

export function exchangeOuraCode(config: OuraConfig, code: string, fetchImpl: Fetch = fetch, now = Date.now()) {
  if (!code) throw new Error("Oura authorization code is missing.");
  return requestTokens(config, { grant_type: "authorization_code", code, redirect_uri: config.redirectUri }, fetchImpl, now);
}
export function refreshOuraTokens(config: OuraConfig, refreshToken: string, fetchImpl: Fetch = fetch, now = Date.now()) {
  if (!refreshToken) throw new Error("Oura refresh token is missing.");
  return requestTokens(config, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl, now);
}

async function ouraGet(path: string, accessToken: string, query: URLSearchParams | null, fetchImpl: Fetch) {
  const url = new URL(`${API_BASE_URL}/${path}`);
  if (query) url.search = query.toString();
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetchImpl(url, { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } });
    if (response.status !== 429 && ![500, 502, 503, 504].includes(response.status)) break;
    if (attempt === 2) break;
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter >= 0 ? Math.min(5_000, retryAfter * 1000) : 250 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  if (!response) throw new Error("Oura API request did not complete.");
  const payload = await boundedJson(response);
  if (!response.ok) throw new Error(`Oura API request failed with HTTP ${response.status}.`);
  return payload;
}

export async function getOuraProfile(accessToken: string, fetchImpl: Fetch = fetch) {
  const profile = record(await ouraGet("personal_info", accessToken, null, fetchImpl), "Oura profile response was invalid.");
  return { userId: requiredString(profile.id, "Oura profile response omitted a valid user ID.") };
}

function addOneDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf())) throw new Error("Oura date is invalid.");
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

export async function getOuraCollection(resource: "daily_readiness" | "sleep", accessToken: string,
  startDate: string, endDate: string, fetchImpl: Fetch = fetch): Promise<JsonRecord[]> {
  const records: JsonRecord[] = [];
  let nextToken: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ start_date: startDate, end_date: resource === "sleep" ? addOneDay(endDate) : endDate });
    if (nextToken) query.set("next_token", nextToken);
    const payload = record(await ouraGet(resource, accessToken, query, fetchImpl), "Oura collection response was invalid.");
    if (!Array.isArray(payload.data)) throw new Error("Oura collection omitted data.");
    for (const item of payload.data) {
      const value = record(item, "Oura record was invalid.");
      if (typeof value.day !== "string" || (value.day >= startDate && value.day <= endDate)) records.push(value);
    }
    if (payload.next_token === undefined || payload.next_token === null) return records;
    nextToken = requiredString(payload.next_token, "Oura pagination token was invalid.");
    if (seen.has(nextToken)) throw new Error("Oura repeated a pagination token.");
    seen.add(nextToken);
  }
  throw new Error("Oura pagination exceeded the safety limit.");
}

export type SleepStage = "rem" | "light" | "deep" | "awake";
export function decodeOuraSleepStages(value: unknown) {
  if (typeof value !== "string" || !/^[1-4]+$/.test(value)) return [];
  const stages: Record<string, SleepStage> = { "1": "deep", "2": "light", "3": "rem", "4": "awake" };
  const segments: Array<{ stage: SleepStage; durationSeconds: number }> = [];
  for (const code of value) {
    const stage = stages[code];
    const previous = segments.at(-1);
    if (previous?.stage === stage) previous.durationSeconds += 300;
    else segments.push({ stage, durationSeconds: 300 });
  }
  return segments;
}

export function normalizeOuraDay(input: { date: string; readiness: JsonRecord[]; sleeps: JsonRecord[] }) {
  const readiness = input.readiness.find((item) => item.day === input.date);
  const sleep = input.sleeps.filter((item) => item.day === input.date && item.type === "long_sleep")
    .sort((a, b) => (finiteNumber(b.total_sleep_duration) ?? 0) - (finiteNumber(a.total_sleep_duration) ?? 0))[0];
  if (!readiness || !sleep) return { status: "not_current" as const };
  const contributors = record(readiness.contributors, "Oura readiness contributors were invalid.");
  return { status: "complete" as const, readinessScore: finiteNumber(readiness.score),
    hrvBalanceScore: finiteNumber(contributors.hrv_balance),
    restingHeartRateContributorScore: finiteNumber(contributors.resting_heart_rate),
    sleepBalanceScore: finiteNumber(contributors.sleep_balance),
    bodyTemperatureContributorScore: finiteNumber(contributors.body_temperature),
    previousDayActivityScore: finiteNumber(contributors.previous_day_activity),
    sleepAverageHeartRateBpm: finiteNumber(sleep.average_heart_rate), sleepAverageHrvMs: finiteNumber(sleep.average_hrv),
    sleepTotalSeconds: finiteNumber(sleep.total_sleep_duration), deepSleepSeconds: finiteNumber(sleep.deep_sleep_duration),
    sleepStartAt: typeof sleep.bedtime_start === "string" ? Date.parse(sleep.bedtime_start) : null,
    sleepEndAt: typeof sleep.bedtime_end === "string" ? Date.parse(sleep.bedtime_end) : null,
    sourceUpdatedAt: typeof sleep.timestamp === "string" ? Date.parse(sleep.timestamp) : null,
    sleepStages: decodeOuraSleepStages(sleep.sleep_phase_5_min) };
}
