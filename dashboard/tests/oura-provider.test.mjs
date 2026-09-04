import assert from "node:assert/strict";
import test from "node:test";
import { buildOuraAuthorizationUrl, decodeOuraSleepStages, exchangeOuraCode,
  normalizeOuraDay, refreshOuraTokens } from "../app/providers/oura.ts";

const config = { clientId: "oura-client", clientSecret: "oura-secret",
  redirectUri: "https://wellness.example/oauth/oura/callback" };

test("builds the Oura authorization request with only required dashboard scopes", () => {
  const url = new URL(buildOuraAuthorizationUrl(config, "state-value"));
  assert.equal(url.origin + url.pathname, "https://cloud.ouraring.com/oauth/authorize");
  assert.equal(url.searchParams.get("scope"), "daily personal");
  assert.equal(url.searchParams.get("state"), "state-value");
});

test("exchanges and refreshes rotating Oura tokens", async () => {
  const forms = [];
  const fetchImpl = async (_url, init) => {
    forms.push(Object.fromEntries(new URLSearchParams(init.body)));
    return Response.json({ token_type: "bearer", access_token: `access-${forms.length}`,
      refresh_token: `refresh-${forms.length}`, expires_in: 3600, scope: "daily personal" });
  };
  const first = await exchangeOuraCode(config, "code", fetchImpl, 1_000_000);
  const second = await refreshOuraTokens(config, first.refreshToken, fetchImpl, 2_000_000);
  assert.equal(forms[0].redirect_uri, config.redirectUri);
  assert.equal(forms[1].refresh_token, "refresh-1");
  assert.equal(second.refreshToken, "refresh-2");
  assert.equal(second.expiresAt, 5_540_000);
});

test("decodes and compresses Oura five-minute sleep stages", () => {
  assert.deepEqual(decodeOuraSleepStages("1123344"), [
    { stage: "deep", durationSeconds: 600 }, { stage: "light", durationSeconds: 300 },
    { stage: "rem", durationSeconds: 600 }, { stage: "awake", durationSeconds: 600 },
  ]);
});

test("normalizes only an exact Oura date and selects the main sleep", () => {
  const value = normalizeOuraDay({ date: "2026-09-04",
    readiness: [{ day: "2026-09-04", score: 81, contributors: { hrv_balance: 80,
      resting_heart_rate: 75, sleep_balance: 65, body_temperature: 90, previous_day_activity: 70 } }],
    sleeps: [{ day: "2026-09-04", type: "rest", total_sleep_duration: 800 },
      { day: "2026-09-04", type: "long_sleep", total_sleep_duration: 24000, deep_sleep_duration: 5000,
        average_heart_rate: 52, average_hrv: 44, bedtime_start: "2026-09-03T23:00:00+08:00",
        bedtime_end: "2026-09-04T06:00:00+08:00", timestamp: "2026-09-04T06:10:00+08:00",
        sleep_phase_5_min: "1234" }] });
  assert.equal(value.status, "complete");
  assert.equal(value.readinessScore, 81);
  assert.equal(value.sleepAverageHrvMs, 44);
  assert.equal(value.sleepStages.length, 4);
  assert.deepEqual(normalizeOuraDay({ date: "2026-09-05", readiness: [], sleeps: [] }), { status: "not_current" });
});
