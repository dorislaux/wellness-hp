import assert from "node:assert/strict";
import test from "node:test";

import { formatCalories, formatDuration, formatMetric, formatStrain, readinessTone, timelineTone } from "../app/mock-data.ts";

test("formats strain with exactly one digit after the decimal", () => {
  assert.equal(formatStrain(8.848939), "8.8");
  assert.equal(formatStrain(9), "9.0");
  assert.equal(formatStrain(null), "—");
});

test("formats dashboard measurements with exactly one digit after the decimal", () => {
  assert.equal(formatMetric(87), "87.0");
  assert.equal(formatMetric(63.54), "63.5");
  assert.equal(formatMetric(null), "—");
  assert.equal(formatDuration(462), "7.7 h");
  assert.equal(formatDuration(null), "—");
  assert.equal(formatCalories(2340), "2,340.0");
  assert.equal(formatCalories(null), "—");
});

test("uses the configured readiness timeline thresholds", () => {
  assert.equal(readinessTone(0), "low");
  assert.equal(readinessTone(69), "low");
  assert.equal(readinessTone(70), "fair");
  assert.equal(readinessTone(84), "fair");
  assert.equal(readinessTone(85), "good");
  assert.equal(readinessTone(100), "good");
  assert.equal(readinessTone(null), "missing");
});

test("uses source-specific timeline thresholds at every boundary", () => {
  assert.equal(timelineTone(33, "whoop"), "whoop-low");
  assert.equal(timelineTone(34, "whoop"), "whoop-fair");
  assert.equal(timelineTone(66, "whoop"), "whoop-fair");
  assert.equal(timelineTone(67, "whoop"), "whoop-good");
  assert.equal(timelineTone(69, "oura"), "low");
  assert.equal(timelineTone(70, "oura"), "fair");
  assert.equal(timelineTone(84, "oura"), "fair");
  assert.equal(timelineTone(85, "oura"), "good");
  assert.equal(timelineTone(null, "whoop"), "missing");
});
