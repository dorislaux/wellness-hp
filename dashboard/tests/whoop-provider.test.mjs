import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWhoopAuthorizationUrl,
  exchangeWhoopCode,
  normalizeWhoopDay,
  refreshWhoopTokens,
  WHOOP_SCOPES,
} from "../app/providers/whoop.ts";

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://wellness.example/oauth/whoop/callback",
};

const tokenResponse = () => new Response(JSON.stringify({
  access_token: "access",
  refresh_token: "refresh",
  token_type: "bearer",
  expires_in: 3600,
  scope: WHOOP_SCOPES,
}), { status: 200, headers: { "content-type": "application/json" } });

test("builds an exact WHOOP authorization request", () => {
  const url = new URL(buildWhoopAuthorizationUrl(config, "opaque-state"));
  assert.equal(url.origin, "https://api.prod.whoop.com");
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.equal(url.searchParams.get("scope"), WHOOP_SCOPES);
  assert.equal(url.searchParams.get("state"), "opaque-state");
});

test("exchanges and refreshes rotating WHOOP tokens", async () => {
  const requests = [];
  const fakeFetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return tokenResponse();
  };
  const exchanged = await exchangeWhoopCode(config, "code", fakeFetch, 1_000_000);
  const refreshed = await refreshWhoopTokens(config, exchanged.refreshToken, fakeFetch, 2_000_000);
  assert.equal(exchanged.expiresAt, 4_540_000);
  assert.equal(refreshed.refreshToken, "refresh");
  assert.match(String(requests[0].init.body), /grant_type=authorization_code/);
  assert.match(String(requests[1].init.body), /grant_type=refresh_token/);
});

test("normalizes recovery and strain by the sleep ending on the selected local day", () => {
  const normalized = normalizeWhoopDay({
    date: "2026-08-04",
    sleeps: [{ id: "sleep-1", cycle_id: 7, nap: false, score_state: "SCORED", end: "2026-08-03T22:30:00Z", timezone_offset: "+08:00", updated_at: "2026-08-03T22:35:00Z" }],
    recoveries: [{ sleep_id: "sleep-1", score_state: "SCORED", score: { recovery_score: 82 }, updated_at: "2026-08-03T22:36:00Z" }],
    cycles: [{ id: 7, score_state: "SCORED", score: { strain: 14.2 }, updated_at: "2026-08-03T22:37:00Z" }],
  });
  assert.equal(normalized.status, "complete");
  assert.equal(normalized.recoveryScore, 82);
  assert.equal(normalized.dayStrain, 14.2);
});

test("does not substitute an older WHOOP day", () => {
  assert.deepEqual(normalizeWhoopDay({
    date: "2026-08-05",
    sleeps: [{ id: "sleep-1", nap: false, score_state: "SCORED", end: "2026-08-03T22:30:00Z", timezone_offset: "+08:00" }],
    recoveries: [],
    cycles: [],
  }), { status: "not_current" });
});

test("accepts WHOOP's UTC timezone designator", () => {
  const value = normalizeWhoopDay({
    date: "2026-09-04",
    sleeps: [{ id: "sleep", cycle_id: 10, nap: false, score_state: "SCORED",
      end: "2026-09-04T06:00:00Z", timezone_offset: "Z", updated_at: "2026-09-04T06:10:00Z" }],
    recoveries: [{ sleep_id: "sleep", score_state: "SCORED", score: { recovery_score: 80 } }],
    cycles: [{ id: 10, score_state: "SCORED", score: { strain: 7.1 } }],
  });
  assert.equal(value.status, "complete");
  assert.equal(value.recoveryScore, 80);
});
