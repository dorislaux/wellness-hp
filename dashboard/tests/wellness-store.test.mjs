import assert from "node:assert/strict";
import test from "node:test";

import { writeBatches } from "../db/write-batches.ts";
import { createHouseholdForUser } from "../db/household-store.ts";
import { oldestIncompleteSourceDate, readWellnessSnapshotCache, replaceWellnessSnapshotCache,
  upsertDailyRecords } from "../db/wellness-store.ts";
import { createTestDatabase } from "./d1-test-helper.mjs";

test("writes long sleep-stage sequences in D1-safe batches", async () => {
  const positions = Array.from({ length: 27 }, (_, index) => index);
  const batches = writeBatches(positions, 12);
  assert.deepEqual(batches.map((batch) => batch.length), [12, 12, 3]);
  assert.deepEqual(batches.flat(), positions);
});

test("replaces and isolates the latest rendered snapshot by household", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const first = await createHouseholdForUser({ userId: "first", email: "first@example.test",
      displayName: "First", fullName: "First" }, { name: "First household", timezone: "UTC" }, db);
    const second = await createHouseholdForUser({ userId: "second", email: "second@example.test",
      displayName: "Second", fullName: "Second" }, { name: "Second household", timezone: "UTC" }, db);
    await replaceWellnessSnapshotCache({ householdId: first.householdId, localDate: "2026-09-08",
      snapshotJson: '{"date":"2026-09-08","revision":1}' }, db);
    await replaceWellnessSnapshotCache({ householdId: first.householdId, localDate: "2026-09-08",
      snapshotJson: '{"date":"2026-09-08","revision":2}' }, db);
    assert.equal((await readWellnessSnapshotCache(first.householdId, "2026-09-08", db))?.snapshotJson,
      '{"date":"2026-09-08","revision":2}');
    assert.equal(await readWellnessSnapshotCache(second.householdId, "2026-09-08", db), null);
    assert.equal(await readWellnessSnapshotCache(first.householdId, "2026-09-09", db), null);
  } finally {
    sqlite.close();
  }
});

test("does not erase a complete daily record with a temporary not-current response", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    await createHouseholdForUser({ userId: "owner", email: "owner@example.test", displayName: "Owner", fullName: "Owner" },
      { name: "Household", timezone: "UTC" }, db);
    const memberId = sqlite.prepare("SELECT id FROM members LIMIT 1").get().id;
    await upsertDailyRecords([{ memberId, provider: "oura", localDate: "2026-09-06", status: "complete",
      readinessScore: 82, fetchedAt: 1 }], db);
    await upsertDailyRecords([{ memberId, provider: "oura", localDate: "2026-09-06", status: "not_current",
      fetchedAt: 2 }], db);
    const record = sqlite.prepare("SELECT status, readiness_score, fetched_at FROM daily_source_records").get();
    assert.equal(record.status, "complete");
    assert.equal(record.readiness_score, 82);
    assert.equal(record.fetched_at, 1);
  } finally {
    sqlite.close();
  }
});

test("merges a partial complete refresh without erasing existing metrics", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    await createHouseholdForUser({ userId: "owner", email: "owner@example.test", displayName: "Owner", fullName: "Owner" },
      { name: "Household", timezone: "UTC" }, db);
    const memberId = sqlite.prepare("SELECT id FROM members LIMIT 1").get().id;
    await upsertDailyRecords([{ memberId, provider: "oura", localDate: "2026-09-06", status: "complete",
      readinessScore: 82, sleepTotalSeconds: 25000, fetchedAt: 1 }], db);
    await upsertDailyRecords([{ memberId, provider: "oura", localDate: "2026-09-06", status: "complete",
      readinessScore: 84, sleepTotalSeconds: null, fetchedAt: 2 }], db);
    const record = sqlite.prepare("SELECT readiness_score, sleep_total_seconds, fetched_at FROM daily_source_records").get();
    assert.equal(record.readiness_score, 84);
    assert.equal(record.sleep_total_seconds, 25000);
    assert.equal(record.fetched_at, 2);
  } finally {
    sqlite.close();
  }
});

test("finds the oldest recent source date that needs retrying", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    await createHouseholdForUser({ userId: "owner", email: "owner@example.test", displayName: "Owner", fullName: "Owner" },
      { name: "Household", timezone: "UTC" }, db);
    const memberId = sqlite.prepare("SELECT id FROM members LIMIT 1").get().id;
    await upsertDailyRecords([
      { memberId, provider: "oura", localDate: "2026-09-05", status: "complete", fetchedAt: 1 },
      { memberId, provider: "oura", localDate: "2026-09-06", status: "not_current", fetchedAt: 1 },
      { memberId, provider: "oura", localDate: "2026-09-09", status: "not_current", fetchedAt: 1 },
    ], db);
    assert.equal(await oldestIncompleteSourceDate({ memberId, provider: "oura", startDate: "2026-09-01",
      endDate: "2026-09-10" }, db), "2026-09-06");
  } finally {
    sqlite.close();
  }
});
