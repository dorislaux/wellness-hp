import assert from "node:assert/strict";
import test from "node:test";

import { formatStrain } from "../app/mock-data.ts";

test("formats strain with exactly one digit after the decimal", () => {
  assert.equal(formatStrain(8.848939), "8.8");
  assert.equal(formatStrain(9), "9.0");
  assert.equal(formatStrain(null), "—");
});
