import assert from "node:assert/strict";
import test from "node:test";
import { buildRangeView } from "../app/wellness-data.ts";

test("prefers Oura per metric and falls back to WHOOP recovery metrics", () => {
  const base = { memberId: "member-1", status: "complete", fetchedAt: 1 };
  const view = buildRangeView({
    range: "today",
    date: "2026-09-08",
    timezone: "Asia/Shanghai",
    connections: [
      { id: "oura-1", memberId: "member-1", provider: "oura", status: "connected", grantedScopes: "", lastSuccessAt: 1 },
      { id: "whoop-1", memberId: "member-1", provider: "whoop", status: "connected", grantedScopes: "", lastSuccessAt: 1 },
    ],
    stored: {
      members: [{ id: "member-1", name: "Dory", initials: "D", avatar: "green", displayOrder: 0 }],
      stages: [],
      records: [
        { ...base, provider: "oura", localDate: "2026-09-08", sleepAverageHrvMs: 44,
          sleepAverageHeartRateBpm: null, bodyTemperatureDeviationC: 0.2 },
        { ...base, provider: "whoop", localDate: "2026-09-07", sleepAverageHrvMs: 47,
          sleepAverageHeartRateBpm: 56, skinTemperatureC: 33 },
        { ...base, provider: "whoop", localDate: "2026-09-08", sleepAverageHrvMs: 48,
          sleepAverageHeartRateBpm: 55, skinTemperatureC: 34 },
      ],
    },
  });
  const member = view.members[0];
  assert.equal(member.overnightHrv, 44);
  assert.equal(member.sleepAverageHeartRate, 55);
  assert.equal(member.heartRateBaseline, 55.5);
  assert.equal(member.bodyTemperatureDeviationC, 0.2);
});

test("derives WHOOP body-temperature deviation from the member baseline", () => {
  const base = { memberId: "member-1", provider: "whoop", status: "complete", fetchedAt: 1 };
  const view = buildRangeView({
    range: "today",
    date: "2026-09-08",
    timezone: "Asia/Shanghai",
    connections: [
      { id: "whoop-1", memberId: "member-1", provider: "whoop", status: "connected", grantedScopes: "", lastSuccessAt: 1 },
    ],
    stored: {
      members: [{ id: "member-1", name: "Dory", initials: "D", avatar: "green", displayOrder: 0 }],
      stages: [],
      records: [
        { ...base, localDate: "2026-09-07", skinTemperatureC: 33 },
        { ...base, localDate: "2026-09-08", skinTemperatureC: 34 },
      ],
    },
  });
  assert.equal(view.members[0].bodyTemperatureDeviationC, 0.5);
});
