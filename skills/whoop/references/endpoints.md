# WHOOP user-data endpoints

The API base URL in the supplied OpenAPI specification is
`https://api.prod.whoop.com/developer`. Live access is not implemented yet.

| Resource | Path | OAuth scope | Time basis |
|---|---|---|---|
| `cycles` | `/v2/cycle` | `read:cycles` | Physiological cycle start |
| `recovery` | `/v2/recovery` | `read:recovery` | Related sleep start |
| `sleep` | `/v2/activity/sleep` | `read:sleep` | Sleep start |
| `workouts` | `/v2/activity/workout` | `read:workout` | Workout start |

Collection endpoints accept ISO-8601 `start` and `end` date-times, a `limit` of
at most 25, and a `nextToken` query parameter. Responses contain `records` and
may contain `next_token`; omission means the final page.

Cycles are sleep-to-sleep physiological periods, not midnight-to-midnight days.
Their scores contain whole-cycle strain, energy expenditure in kilojoules,
average heart rate, and maximum heart rate.

For cycles, recovery, sleep, and workouts, `score_state` is one of `SCORED`,
`PENDING_SCORE`, or `UNSCORABLE`. The `score` object is present only for scored
records. Optional sensor-derived values must not be interpreted as zero when
absent.

`v1_id` and `sport_id` are legacy fields and are not used by this skill.
Trusted-partner operations and activity-ID mapping are outside the allowlist.

The reusable client retries `429`, `500`, `502`, `503`, and `504` responses at
most twice. It honors numeric `Retry-After` values up to 60 seconds for `429`
and uses bounded exponential backoff with jitter for temporary server errors.
It does not retry authentication or other client errors.
