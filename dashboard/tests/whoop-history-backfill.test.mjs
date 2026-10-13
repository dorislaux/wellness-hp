import assert from "node:assert/strict";
import test from "node:test";

import { handleWhoopHistoryBackfillRequest } from
  "../app/api/maintenance/whoop-history-backfill/route.ts";
import { getWhoopHistoryBackfillStatus, runWhoopHistoryBackfillChunk,
  WhoopHistoryBackfillError } from "../app/whoop-history-backfill.ts";
import { createHouseholdForUser } from "../db/household-store.ts";
import { finishWhoopHistoryChunk, invalidateWellnessSnapshotCache, listHouseholdConnections,
  listSucceededWhoopHistoryChunks, readWhoopHistoryCoverage, startWhoopHistoryChunk,
  upsertDailyRecords } from "../db/wellness-store.ts";
import { createTestDatabase } from "./d1-test-helper.mjs";

const owner = { userId: "owner-user", email: "owner@example.test", displayName: "Owner", fullName: "Owner" };
const emptyCoverage = { completeDays: 0, firstCompleteDate: null, lastCompleteDate: null,
  usableNights: { hrv: 0, recovery: 0, sleep: 0, allThree: 0 } };
const emptyStatus = { requestedRange: { startDate: "2026-03-28", endDate: "2026-09-23", days: 180 },
  progress: { completedChunks: 0, totalChunks: 13, nextStartDate: "2026-03-28", complete: false },
  coverage: emptyCoverage };

test("WHOOP history requires an authenticated owner and targets their linked member", async () => {
  let runInput;
  const dependencies = {
    user: async () => null,
    household: async () => ({ householdId: "household", role: "owner", timezone: "UTC" }),
    memberId: async () => "owner-member",
    status: async () => emptyStatus,
    run: async (input) => { runInput = input; return { ...emptyStatus, processedRange: null,
      returnedCoverage: null, coverageBefore: emptyCoverage }; },
  };
  const request = () => new Request("https://wellness.example/api/maintenance/whoop-history-backfill",
    { method: "POST", body: "{}" });
  assert.equal((await handleWhoopHistoryBackfillRequest(request(), dependencies)).status, 401);
  dependencies.user = async () => owner;
  dependencies.household = async () => ({ householdId: "household", role: "viewer", timezone: "UTC" });
  assert.equal((await handleWhoopHistoryBackfillRequest(request(), dependencies)).status, 403);
  dependencies.household = async () => ({ householdId: "household", role: "owner", timezone: "Asia/Shanghai" });
  assert.equal((await handleWhoopHistoryBackfillRequest(request(), dependencies)).status, 200);
  assert.deepEqual(runInput, { householdId: "household", memberId: "owner-member",
    timezone: "Asia/Shanghai", endDate: undefined });
  const arbitraryTarget = new Request("https://wellness.example/api/maintenance/whoop-history-backfill",
    { method: "POST", body: JSON.stringify({ memberId: "someone-else" }) });
  assert.equal((await handleWhoopHistoryBackfillRequest(arbitraryTarget, dependencies)).status, 400);
});

test("WHOOP uses the same 180 completed local-day range and bounded chunks as Oura", async () => {
  const calls = [];
  const dependencies = {
    listConnections: async () => [{ id: "owner-whoop", memberId: "owner-member", provider: "whoop",
      status: "connected", grantedScopes: "read:cycles read:recovery read:sleep", lastSuccessAt: 1 }],
    accessToken: async () => "server-side-token",
    collection: async (resource, _token, start, end) => { calls.push({ resource, start, end }); return []; },
    coverage: async () => emptyCoverage,
    succeededChunks: async () => [],
    startAttempt: async () => "attempt",
    finishAttempt: async () => {},
    upsert: async () => {},
    invalidateCache: async () => {},
  };
  const input = { householdId: "household", memberId: "owner-member", timezone: "Asia/Shanghai",
    now: new Date("2026-09-24T15:30:00.000Z") };
  const status = await getWhoopHistoryBackfillStatus(input, dependencies);
  assert.deepEqual(status.requestedRange, { startDate: "2026-03-28", endDate: "2026-09-23", days: 180 });
  const result = await runWhoopHistoryBackfillChunk(input, dependencies);
  assert.deepEqual(result.processedRange, { startDate: "2026-03-28", endDate: "2026-04-10" });
  assert.deepEqual(calls, ["cycles", "recovery", "sleep"].map((resource) => ({ resource,
    start: "2026-03-26T00:00:00.000Z", end: "2026-04-12T23:59:59.999Z" })));
});

test("WHOOP backfill preserves stored values, missing values stay missing, and reruns do not duplicate", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const household = await createHouseholdForUser(owner, { name: "Household", timezone: "Asia/Shanghai" }, db);
    const memberId = sqlite.prepare("SELECT id FROM members LIMIT 1").get().id;
    sqlite.prepare(`INSERT INTO provider_connections
      (id, member_id, provider, granted_scopes, status, connected_at, created_at, updated_at)
      VALUES (?, ?, 'whoop', 'read:cycles read:recovery read:sleep', 'connected', 1, 1, 1)`)
      .run("whoop-connection", memberId);
    await upsertDailyRecords([{ memberId, localDate: "2026-03-28", provider: "whoop", status: "complete",
      recoveryScore: 99, sleepTotalSeconds: 25000, fetchedAt: 1 }], db);
    const collection = async (resource) => {
      if (resource === "sleep") return [{ id: "sleep-1", cycle_id: 7, nap: false, score_state: "SCORED",
        start: "2026-03-27T22:00:00Z", end: "2026-03-28T06:00:00Z", timezone_offset: "Z",
        score: { stage_summary: { total_light_sleep_time_milli: 14_400_000,
          total_slow_wave_sleep_time_milli: 5_400_000, total_rem_sleep_time_milli: 7_200_000 } } }];
      if (resource === "recovery") return [{ sleep_id: "sleep-1", score_state: "SCORED",
        score: { hrv_rmssd_milli: 48.5 } }];
      return [{ id: 7, score_state: "SCORED", score: { strain: 9.2 } }];
    };
    const dependencies = {
      listConnections: (id) => listHouseholdConnections(id, db),
      accessToken: async () => "server-side-token",
      collection,
      coverage: (id, startDate, endDate) => readWhoopHistoryCoverage({ memberId: id, startDate, endDate }, db),
      succeededChunks: (id, startDate, endDate) =>
        listSucceededWhoopHistoryChunks({ connectionId: id, startDate, endDate }, db),
      startAttempt: (id, date) => startWhoopHistoryChunk(id, date, db),
      finishAttempt: (id, status, code) => finishWhoopHistoryChunk(id, status, code, db),
      upsert: (records) => upsertDailyRecords(records, db),
      invalidateCache: (id) => invalidateWellnessSnapshotCache(id, db),
    };
    await runWhoopHistoryBackfillChunk({ householdId: household.householdId, memberId,
      timezone: "Asia/Shanghai", now: new Date("2026-09-24T08:00:00.000Z") }, dependencies);
    const preserved = sqlite.prepare(`SELECT recovery_score, sleep_total_seconds, sleep_average_hrv_ms
      FROM daily_source_records WHERE local_date = '2026-03-28' AND provider = 'whoop'`).get();
    assert.equal(preserved.recovery_score, 99);
    assert.equal(preserved.sleep_total_seconds, 27000);
    assert.equal(preserved.sleep_average_hrv_ms, 48.5);
    const missing = sqlite.prepare(`SELECT status, recovery_score FROM daily_source_records
      WHERE local_date = '2026-03-29' AND provider = 'whoop'`).get();
    assert.equal(missing.status, "not_current");
    assert.equal(missing.recovery_score, null);
    await runWhoopHistoryBackfillChunk({ householdId: household.householdId, memberId,
      timezone: "Asia/Shanghai", now: new Date("2026-09-24T08:00:00.000Z") },
    { ...dependencies, succeededChunks: async () => [] });
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM daily_source_records WHERE provider = 'whoop'")
      .get().count, 14);
    assert.equal(sqlite.prepare(`SELECT recovery_score FROM daily_source_records
      WHERE local_date = '2026-03-28' AND provider = 'whoop'`).get().recovery_score, 99);
  } finally {
    sqlite.close();
  }
});

test("WHOOP partial failures leave the chunk resumable and write nothing", async () => {
  let upserted = false;
  const finishes = [];
  const dependencies = {
    listConnections: async () => [{ id: "connection", memberId: "member", provider: "whoop",
      status: "connected", grantedScopes: "read:recovery", lastSuccessAt: 1 }],
    accessToken: async () => "server-side-token",
    collection: async (resource) => {
      if (resource === "recovery") throw new Error("WHOOP API request failed with HTTP 503.");
      return [];
    },
    coverage: async () => emptyCoverage,
    succeededChunks: async () => [],
    startAttempt: async () => "attempt",
    finishAttempt: async (_id, status, code) => finishes.push({ status, code }),
    upsert: async () => { upserted = true; },
    invalidateCache: async () => {},
  };
  await assert.rejects(runWhoopHistoryBackfillChunk({ householdId: "household", memberId: "member",
    timezone: "UTC", now: new Date("2026-09-24T12:00:00.000Z") }, dependencies),
  (error) => error instanceof WhoopHistoryBackfillError && error.code === "backfill_failed" &&
    error.retryStartDate === "2026-03-28");
  assert.equal(upserted, false);
  assert.deepEqual(finishes, [{ status: "failed", code: "http_503" }]);
});
