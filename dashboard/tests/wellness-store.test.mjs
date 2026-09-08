import assert from "node:assert/strict";
import test from "node:test";

import { writeBatches } from "../db/write-batches.ts";
import { createHouseholdForUser } from "../db/household-store.ts";
import { readWellnessSnapshotCache, replaceWellnessSnapshotCache } from "../db/wellness-store.ts";
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
