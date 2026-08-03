# WHOOP V2 resources

Source: the official WHOOP API OpenAPI 3.0.1 spec (`title: "WHOOP API"`), pasted directly into the building session on 2026-08-03. This environment's egress policy blocks `developer.whoop.com` directly, so this file previously relied on search-engine summaries and a third-party client library instead of the real spec — everything below is now checked against the actual spec, not a summary of it.

Every resource the CLI implements matched the spec exactly on first check: base URL, path, query parameter names, response field names, and OAuth scopes. Nothing needed correcting.

| Resource | Path suffix | `operationId` | Time parameters | Collection | Required scope |
|---|---|---|---|---|---|
| `cycle` | `cycle` | `getCycleCollection` | `start_datetime`, `end_datetime` | yes | `read:cycles` |
| `recovery` | `recovery` | `getRecoveryCollection` | `start_datetime`, `end_datetime` | yes | `read:recovery` |
| `sleep` | `activity/sleep` | `getSleepCollection` | `start_datetime`, `end_datetime` | yes | `read:sleep` |
| `workout` | `activity/workout` | `getWorkoutCollection` | `start_datetime`, `end_datetime` | yes | `read:workout` |
| `body_measurement` | `user/measurement/body` | `getBodyMeasurement` | none | no | `read:body_measurement` |
| `profile_basic` | `user/profile/basic` | `getProfileBasic` | none | no | `read:profile` |

Notes specific to WHOOP's V2 API, as distinct from Oura's:

- Collection responses use a `records` array, not `data`. The CLI normalizes this to `data` in its own output for consistency with the Oura skill's shape.
- The pagination continuation token is asymmetric: a response reports it as `next_token`, but the next request must send it back as `nextToken`. The CLI handles this translation; callers of `get --all-pages` never see it.
- The spec caps `limit` at 25 per page (default 10 if omitted). The CLI always requests 25 explicitly, to minimize round trips when `--all-pages` is used.
- **Refresh tokens rotate on every use.** WHOOP invalidates the previous refresh token the moment a new one is issued. The CLI always persists whatever refresh token comes back from a refresh call; there is no option to keep reusing an old one.
- `profile_basic` is named to avoid colliding with this CLI's own `--profile` flag (the local OAuth account selector), which is an unrelated concept.
- Time ranges use full ISO 8601 datetimes (`start`/`end` upstream), not calendar dates. The `daily` command accepts `--start-date`/`--end-date` for convenience and expands them to full-day UTC bounds internally.
- The `offline` scope requested by default (see `DEFAULT_SCOPES` in `whoop.py`) is **not** listed in the spec's `securitySchemes.OAuth.flows.authorizationCode.scopes` — that section only enumerates scopes that gate specific endpoints, so its absence doesn't confirm or rule out whether `offline` is real. This was asserted by secondary sources during the original build and remains unverified against a primary source. If a real `authorize` call doesn't return a `refresh_token`, that's the first thing to check.

## Fields selected for this project

The CLI's `get`/`daily` commands always return the full JSON record for whatever resource is queried — WHOOP's API has no `fields` sparse-fieldset parameter to filter server-side (unlike Oura's). The list below is a decision about which of those fields matter for *this* project's cross-provider comparison and future dashboard work, so a future reader knows what to actually pull out of the full payload rather than re-deciding it. Fields not listed here are still present in the raw response; they're just not part of the plan.

### Recovery — mixed treatment: one field kept separate, three pooled with Oura

- **`recovery_score` — kept WHOOP-specific, not pooled with Oura's readiness score.** WHOOP and Oura calculate recovery/readiness by different methodologies, so treat these as two distinct metrics to display side by side, never averaged or merged into one number.
- **`resting_heart_rate`, `hrv_rmssd_milli`, `skin_temp_celsius` — pooled with Oura's equivalent fields** for direct comparison between the two devices. (`spo2_percentage`, also in the `Recovery` schema, is deliberately not part of this list.)

### Sleep — three percentage scores only

- `sleep_performance_percentage`
- `sleep_efficiency_percentage`
- `sleep_consistency_percentage`

The stage breakdown (`stage_summary`), the sleep-need breakdown (`sleep_needed`), and `respiratory_rate` are all available in the same response but out of scope for now.

### Workout — everything

Every field in `WorkoutV2` and its nested `score`/`zone_durations` objects: `sport_name`, `start`/`end`/`timezone_offset`, `score_state`, `strain`, `average_heart_rate`, `max_heart_rate`, `kilojoule`, `percent_recorded`, `distance_meter`, `altitude_gain_meter`, `altitude_change_meter`, and all six `zone_durations` buckets. Workout depth is considered a real advantage over Oura's workout resource, so nothing here is trimmed.

## Confirmed by the spec but not implemented

These exist in the real API and were deliberately left out of this CLI's allowlist — noted here so a future change is a decision, not a rediscovery:

- **By-ID lookups**: `getCycleById` (`/v2/cycle/{cycleId}`), `getSleepById` (`/v2/activity/sleep/{sleepId}`), `getWorkoutById` (`/v2/activity/workout/{workoutId}`), `getRecoveryForCycle` (`/v2/cycle/{cycleId}/recovery`), `getSleepForCycle` (`/v2/cycle/{cycleId}/sleep`). The CLI only exposes the collection form of each resource; fetching one specific record by ID isn't supported.
- **`revokeUserOAuthAccess`** (`DELETE /v2/user/access`) — lets a user revoke their own granted access token. There's no `revoke` command in the CLI; deauthorizing today means removing the profile's token file by hand or revoking access on WHOOP's own account settings page. A reasonable candidate for a future command, mirroring `authorize`.
- **`getActivityMapping`** (`/v1/activity-mapping/{activityV1Id}`) — looks up the v2 UUID for a legacy v1 activity ID. Only relevant for data recorded before WHOOP's v1→v2 migration; not needed for new integrations.
- **The entire Partner API** (`/v2/partner/*`) — lab requisitions, service requests, diagnostic report uploads. This uses a completely different OAuth flow (`clientCredentials`, not `authorizationCode`), a separate token URL, and a `Trusted Partner` security scheme meant for approved WHOOP integration partners (e.g., diagnostic lab providers), not personal data access. Out of scope for this skill entirely.
