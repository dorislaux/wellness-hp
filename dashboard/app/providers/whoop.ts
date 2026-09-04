import type { ProviderTokenSecret } from "../provider-crypto";

export const WHOOP_SCOPES = [
  "offline",
  "read:profile",
  "read:cycles",
  "read:recovery",
  "read:sleep",
].join(" ");

const AUTHORIZATION_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const API_BASE_URL = "https://api.prod.whoop.com/developer";
const MAX_RESPONSE_BYTES = 5_000_000;

export type WhoopConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type WhoopTokenSet = ProviderTokenSecret & {
  expiresAt: number;
  grantedScopes: string;
};

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

export function validateWhoopConfig(config: WhoopConfig): WhoopConfig {
  if (!config.clientId || !config.clientSecret) throw new Error("WHOOP configuration is incomplete.");
  const redirect = new URL(config.redirectUri);
  if (redirect.protocol !== "https:" || redirect.username || redirect.password || redirect.hash) {
    throw new Error("WHOOP redirect URI must be a safe HTTPS URL.");
  }
  return config;
}

export function buildWhoopAuthorizationUrl(config: WhoopConfig, state: string): string {
  validateWhoopConfig(config);
  if (state.length < 8) throw new Error("WHOOP authorization state is invalid.");
  const url = new URL(AUTHORIZATION_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: WHOOP_SCOPES,
    state,
  }).toString();
  return url.toString();
}

async function boundedJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_RESPONSE_BYTES) throw new Error("WHOOP response exceeded the size limit.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error("WHOOP response exceeded the size limit.");
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("WHOOP returned malformed JSON.");
  }
}

function parseTokenResponse(payload: unknown, now: number): WhoopTokenSet {
  const body = record(payload, "WHOOP token response was invalid.");
  const accessToken = requiredString(body.access_token, "WHOOP token response omitted the access token.");
  const refreshToken = requiredString(body.refresh_token, "WHOOP token response omitted the refresh token.");
  const grantedScopes = requiredString(body.scope, "WHOOP token response omitted granted scopes.");
  if (!grantedScopes.split(" ").includes("offline")) throw new Error("WHOOP did not grant offline access.");
  if (typeof body.token_type !== "string" || body.token_type.toLowerCase() !== "bearer") {
    throw new Error("WHOOP returned an unsupported token type.");
  }
  if (typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 60) {
    throw new Error("WHOOP returned an invalid token expiry.");
  }
  return {
    accessToken,
    refreshToken,
    grantedScopes,
    expiresAt: now + body.expires_in * 1000 - 60_000,
  };
}

async function requestTokens(
  config: WhoopConfig,
  fields: Record<string, string>,
  fetchImpl: Fetch,
  now: number,
): Promise<WhoopTokenSet> {
  validateWhoopConfig(config);
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...fields,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  const payload = await boundedJson(response);
  if (!response.ok) throw new Error(`WHOOP token request failed with HTTP ${response.status}.`);
  return parseTokenResponse(payload, now);
}

export function exchangeWhoopCode(
  config: WhoopConfig,
  code: string,
  fetchImpl: Fetch = fetch,
  now = Date.now(),
): Promise<WhoopTokenSet> {
  if (!code) throw new Error("WHOOP authorization code is missing.");
  return requestTokens(
    config,
    { grant_type: "authorization_code", code, redirect_uri: config.redirectUri },
    fetchImpl,
    now,
  );
}

export function refreshWhoopTokens(
  config: WhoopConfig,
  refreshToken: string,
  fetchImpl: Fetch = fetch,
  now = Date.now(),
): Promise<WhoopTokenSet> {
  if (!refreshToken) throw new Error("WHOOP refresh token is missing.");
  return requestTokens(
    config,
    { grant_type: "refresh_token", refresh_token: refreshToken, scope: "offline" },
    fetchImpl,
    now,
  );
}

async function whoopGet(path: string, accessToken: string, query: URLSearchParams | null, fetchImpl: Fetch) {
  const url = new URL(`${API_BASE_URL}${path}`);
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
  if (!response) throw new Error("WHOOP API request did not complete.");
  const payload = await boundedJson(response);
  if (!response.ok) throw new Error(`WHOOP API request failed with HTTP ${response.status}.`);
  return payload;
}

export async function getWhoopProfile(accessToken: string, fetchImpl: Fetch = fetch) {
  const profile = record(
    await whoopGet("/v2/user/profile/basic", accessToken, null, fetchImpl),
    "WHOOP profile response was invalid.",
  );
  if (typeof profile.user_id !== "number" || !Number.isSafeInteger(profile.user_id) || profile.user_id <= 0) {
    throw new Error("WHOOP profile response omitted a valid user ID.");
  }
  return { userId: String(profile.user_id) };
}

export async function getWhoopCollection(
  resource: "cycles" | "recovery" | "sleep",
  accessToken: string,
  start: string,
  end: string,
  fetchImpl: Fetch = fetch,
): Promise<JsonRecord[]> {
  const paths = { cycles: "/v2/cycle", recovery: "/v2/recovery", sleep: "/v2/activity/sleep" };
  const records: JsonRecord[] = [];
  let nextToken: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ start, end, limit: "25" });
    if (nextToken) query.set("nextToken", nextToken);
    const payload = record(
      await whoopGet(paths[resource], accessToken, query, fetchImpl),
      "WHOOP collection response was invalid.",
    );
    if (!Array.isArray(payload.records)) throw new Error("WHOOP collection omitted records.");
    for (const item of payload.records) records.push(record(item, "WHOOP record was invalid."));
    if (payload.next_token === undefined) return records;
    nextToken = requiredString(payload.next_token, "WHOOP pagination token was invalid.");
    if (seen.has(nextToken)) throw new Error("WHOOP repeated a pagination token.");
    seen.add(nextToken);
  }
  throw new Error("WHOOP pagination exceeded the safety limit.");
}

function localDate(instant: unknown, offset: unknown): string | null {
  if (typeof instant !== "string" || typeof offset !== "string") return null;
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!match) return null;
  const value = Date.parse(instant);
  if (!Number.isFinite(value)) return null;
  const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "+" ? 1 : -1);
  return new Date(value + minutes * 60_000).toISOString().slice(0, 10);
}

export function normalizeWhoopDay(input: {
  date: string;
  sleeps: JsonRecord[];
  recoveries: JsonRecord[];
  cycles: JsonRecord[];
}) {
  const sleep = input.sleeps.find(
    (item) =>
      item.nap === false &&
      item.score_state === "SCORED" &&
      localDate(item.end, item.timezone_offset) === input.date,
  );
  if (!sleep) return { status: "not_current" as const };
  const recovery = input.recoveries.find(
    (item) => item.sleep_id === sleep.id && item.score_state === "SCORED",
  );
  const cycle = input.cycles.find(
    (item) => item.id === sleep.cycle_id && item.score_state === "SCORED",
  );
  const recoveryScore = recovery ? record(recovery.score, "WHOOP recovery score was invalid.") : null;
  const cycleScore = cycle ? record(cycle.score, "WHOOP cycle score was invalid.") : null;
  if (typeof recoveryScore?.recovery_score !== "number") return { status: "not_current" as const };
  return {
    status: "complete" as const,
    recoveryScore: recoveryScore.recovery_score,
    dayStrain: typeof cycleScore?.strain === "number" ? cycleScore.strain : null,
    sourceUpdatedAt: Math.max(
      Date.parse(String(sleep.updated_at ?? "")) || 0,
      Date.parse(String(recovery?.updated_at ?? "")) || 0,
      Date.parse(String(cycle?.updated_at ?? "")) || 0,
    ),
  };
}
