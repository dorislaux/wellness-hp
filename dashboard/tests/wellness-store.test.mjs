import assert from "node:assert/strict";
import test from "node:test";

import { writeBatches } from "../db/write-batches.ts";

test("writes long sleep-stage sequences in D1-safe batches", async () => {
  const positions = Array.from({ length: 27 }, (_, index) => index);
  const batches = writeBatches(positions, 12);
  assert.deepEqual(batches.map((batch) => batch.length), [12, 12, 3]);
  assert.deepEqual(batches.flat(), positions);
});
