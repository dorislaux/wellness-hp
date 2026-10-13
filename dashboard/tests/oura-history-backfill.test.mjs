import assert from "node:assert/strict";
import test from "node:test";

import { handleOuraHistoryBackfillRequest } from "../app/api/maintenance/oura-history-backfill/route.ts";
import { OURA_HISTORY_BACKFILL_CHUNK_DAYS, OuraHistoryBackfillError, ouraHistoryRange,
  runOuraHistoryBackfillChunk } from "../app/oura-history-backfill.ts";
import { createHouseholdForUser } from "../db/household-store.ts";
import { invalidateWellnessSnapshotCache, listHouseholdConnections, listSucceededOuraHistoryChunks,
  readOuraHistoryCoverage, startOuraHistoryChunk, finishOuraHistoryChunk, upsertDailyRecords } from
  "../db/wellness-store.ts";
import { createTestDatabase } from "./d1-test-helper.mjs";

const owner = { userId: "owner-user", email: "owner@example.test", displayName: "Owner", fullName: "Owner" };
const emptyCoverage = { completeDays: 0, firstCompleteDate: null, lastCompleteDate: null,
  usableNights: { hrv: 0, hrvBalance: 0, readiness: 0, allThree: 0 } };
const emptyStatus = { requestedRange: { startDate: "2026-03-28", endDate: "2026-09-23", days: 180 },
  progress: { completedChunks: 0, totalChunks: 13, nextStartDate: "2026-03-28", complete: false },
  coverage: emptyCoverage };

test("requires authentication and owner authorization, then targets only the owner's linked member", async () => {
  let runInput;
  const dependencies = {
    user: async () => null,
    household: async () => ({ householdId: "household", role: "owner", timezone: "UTC" }),
    memberId: async () => "owner-member",
    status: async () => emptyStatus,
    run: async (input) => { runInput = input; return { ...emptyStatus, processedRange: null,
      returnedCoverage: null, coverageBefore: emptyCoverage }; },
  };
  const request = () => new Request("https://wellness.example/api/maintenance/oura-history-backfill",
    { method: "POST", body: "{}" });
  assert.equal((await handleOuraHistoryBackfillRequest(request(), dependencies)).status, 401);
  dependencies.user = async () => owner;
  dependencies.household = async () => ({ householdId: "household", role: "viewer", timezone: "UTC" });
  assert.equal((await handleOuraHistoryBackfillRequest(request(), dependencies)).status, 403);
  dependencies.household = async () => ({ householdId: "household", role: "owner", timezone: "Asia/Shanghai" });
  assert.equal((await handleOuraHistoryBackfillRequest(request(), dependencies)).status, 200);
  assert.deepEqual(runInput, { householdId: "household", memberId: "owner-member",
    timezone: "Asia/Shanghai", endDate: undefined });
  const arbitraryTarget = new Request("https://wellness.example/api/maintenance/oura-history-backfill",
    { method: "POST", body: JSON.stringify({ memberId: "someone-else" }) });
  assert.equal((await handleOuraHistoryBackfillRequest(arbitraryTarget, dependencies)).status, 400);
});

test("uses exactly 180 completed calendar days in the household timezone", () => {
  assert.deepEqual(ouraHistoryRange(new Date("2026-09-24T15:30:00.000Z"), "Asia/Shanghai"),
    { startDate: "2026-03-28", endDate: "2026-09-23", days: 180 });
  assert.deepEqual(ouraHistoryRange(new Date("2026-09-24T17:30:00.000Z"), "Asia/Shanghai"),
    { startDate: "2026-03-29", endDate: "2026-09-24", days: 180 });
  assert.throws(() => ouraHistoryRange(new Date("2026-09-24T15:30:00.000Z"), "Asia/Shanghai", "2026-09-24"),
    (error) => error instanceof OuraHistoryBackfillError && error.code === "invalid_end_date");
});

function datesBetween(startDate, endDate) {
  const dates = [];
  for (let date = startDate; date <= endDate;) {
    dates.push(date);
    const next = new Date(`${date}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    date = next.toISOString().slice(0, 10);
  }
  return dates;
}

test("runs in resumable chunks, preserves existing metrics, and is safe to repeat", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const household = await createHouseholdForUser(owner, { name: "Household", timezone: "Asia/Shanghai" }, db);
    const memberId = sqlite.prepare("SELECT id FROM members LIMIT 1").get().id;
    sqlite.prepare(`INSERT INTO provider_connections
      (id, member_id, provider, granted_scopes, status, connected_at, created_at, updated_at)
      VALUES (?, ?, 'oura', 'daily personal', 'connected', 1, 1, 1)`).run("oura-connection", memberId);
    await upsertDailyRecords([{ memberId, localDate: "2026-03-28", provider: "oura", status: "complete",
      readinessScore: 99, sleepTotalSeconds: 25000, fetchedAt: 1 }], db);
    const collection = async (resource, _token, startDate, endDate) => datesBetween(startDate, endDate).flatMap((day) => {
      if (day === "2026-04-02") return [];
      if (resource === "daily_activity") return [{ day, active_calories: 400, total_calories: 2200 }];
      if (resource === "daily_readiness") return day === "2026-03-28" ? [] :
        [{ day, score: 80, contributors: { hrv_balance: 75 } }];
      return [{ day, type: "long_sleep", average_hrv: 45,
        ...(day === "2026-03-28" ? {} : { total_sleep_duration: 24000 }) }];
    });
    const dependencies = {
      listConnections: (id) => listHouseholdConnections(id, db),
      accessToken: async () => "server-side-token",
      collection,
      coverage: (id, startDate, endDate) => readOuraHistoryCoverage({ memberId: id, startDate, endDate }, db),
      succeededChunks: (id, startDate, endDate) =>
        listSucceededOuraHistoryChunks({ connectionId: id, startDate, endDate }, db),
      startAttempt: (id, date) => startOuraHistoryChunk(id, date, db),
      finishAttempt: (id, status, code) => finishOuraHistoryChunk(id, status, code, db),
      upsert: (records) => upsertDailyRecords(records, db),
      invalidateCache: (id) => invalidateWellnessSnapshotCache(id, db),
    };
    let result;
    let firstResult;
    for (let index = 0; index < Math.ceil(180 / OURA_HISTORY_BACKFILL_CHUNK_DAYS); index += 1) {
      result = await runOuraHistoryBackfillChunk({ householdId: household.householdId, memberId,
        timezone: "Asia/Shanghai", now: new Date("2026-09-24T08:00:00.000Z") }, dependencies);
      if (index === 0) firstResult = result;
    }
    assert.deepEqual(firstResult.processedRange, { startDate: "2026-03-28", endDate: "2026-04-10" });
    assert.equal(firstResult.returnedCoverage.firstDate, "2026-03-28");
    assert.equal(firstResult.returnedCoverage.lastDate, "2026-04-10");
    assert.equal(firstResult.returnedCoverage.returnedDays, 13);
    assert.equal(firstResult.coverageBefore.completeDays, 1);
    assert.equal(result.progress.complete, true);
    assert.equal(result.coverage.usableNights.hrv, 179);
    assert.equal(result.coverage.usableNights.hrvBalance, 178);
    assert.equal(result.coverage.usableNights.readiness, 179);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM daily_source_records WHERE provider = 'oura'").get().count, 180);
    const preserved = sqlite.prepare(`SELECT readiness_score, sleep_total_seconds FROM daily_source_records
      WHERE local_date = '2026-03-28' AND provider = 'oura'`).get();
    assert.equal(preserved.readiness_score, 99);
    assert.equal(preserved.sleep_total_seconds, 25000);
    const missing = sqlite.prepare(`SELECT status, sleep_average_hrv_ms, hrv_balance_score, readiness_score
      FROM daily_source_records WHERE local_date = '2026-04-02' AND provider = 'oura'`).get();
    assert.equal(missing.status, "not_current");
    assert.equal(missing.sleep_average_hrv_ms, null);
    assert.equal(missing.hrv_balance_score, null);
    assert.equal(missing.readiness_score, null);

    const repeatDependencies = { ...dependencies, succeededChunks: async () => [] };
    await runOuraHistoryBackfillChunk({ householdId: household.householdId, memberId,
      timezone: "Asia/Shanghai", now: new Date("2026-09-24T08:00:00.000Z") }, repeatDependencies);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM daily_source_records WHERE provider = 'oura'").get().count, 180);
    assert.equal(sqlite.prepare(`SELECT readiness_score FROM daily_source_records
      WHERE local_date = '2026-03-28' AND provider = 'oura'`).get().readiness_score, 99);
  } finally {
    sqlite.close();
  }
});

test("selects only the targeted member's Oura connection and never writes WHOOP records", async () => {
  let selectedConnection;
  let written = [];
  const dependencies = {
    listConnections: async () => [
      { id: "owner-whoop", memberId: "owner-member", provider: "whoop", status: "connected",
        grantedScopes: "read:recovery", lastSuccessAt: 1 },
      { id: "other-oura", memberId: "other-member", provider: "oura", status: "connected",
        grantedScopes: "daily personal", lastSuccessAt: 1 },
      { id: "owner-oura", memberId: "owner-member", provider: "oura", status: "connected",
        grantedScopes: "daily personal", lastSuccessAt: 1 },
    ],
    accessToken: async (connection) => { selectedConnection = connection.id; return "server-side-token"; },
    collection: async () => [],
    coverage: async () => emptyCoverage,
    succeededChunks: async () => [],
    startAttempt: async (connectionId) => { assert.equal(connectionId, "owner-oura"); return "attempt"; },
    finishAttempt: async () => {},
    upsert: async (records) => { written = records; },
    invalidateCache: async () => {},
  };
  await runOuraHistoryBackfillChunk({ householdId: "household", memberId: "owner-member", timezone: "UTC",
    now: new Date("2026-09-24T12:00:00.000Z") }, dependencies);
  assert.equal(selectedConnection, "owner-oura");
  assert.ok(written.every((record) => record.memberId === "owner-member" && record.provider === "oura"));
});

test("records a partial provider failure without writing the chunk and retries the same boundary", async () => {
  let upserted = false;
  const finishes = [];
  const dependencies = {
    listConnections: async () => [{ id: "connection", memberId: "member", provider: "oura", status: "connected",
      grantedScopes: "daily personal", lastSuccessAt: 1 }],
    accessToken: async () => "server-side-token",
    collection: async (resource) => {
      if (resource === "sleep") throw new Error("Oura API request failed with HTTP 503.");
      return [];
    },
    coverage: async () => emptyCoverage,
    succeededChunks: async () => [],
    startAttempt: async () => "attempt",
    finishAttempt: async (_id, status, code) => finishes.push({ status, code }),
    upsert: async () => { upserted = true; },
    invalidateCache: async () => {},
  };
  await assert.rejects(runOuraHistoryBackfillChunk({ householdId: "household", memberId: "member", timezone: "UTC",
    now: new Date("2026-09-24T12:00:00.000Z") }, dependencies),
  (error) => error instanceof OuraHistoryBackfillError && error.code === "backfill_failed" &&
    error.retryStartDate === "2026-03-28");
  assert.equal(upserted, false);
  assert.deepEqual(finishes, [{ status: "failed", code: "http_503" }]);
});
