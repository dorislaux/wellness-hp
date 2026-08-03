# WHOOP V2 resources

Source: [WHOOP for Developers](https://developer.whoop.com/docs/introduction/), checked via search summaries on 2026-08-03 because this environment's egress policy blocks `developer.whoop.com` directly. Verify against the live docs before relying on exact field names in a new integration.

The scope column is a troubleshooting hint based on WHOOP's OAuth scope names; the API remains authoritative. The CLI does not reject a request locally based on this column.

| Resource | Path suffix | Time parameters | Collection | Expected scope |
|---|---|---|---|---|
| `cycle` | `cycle` | `start_datetime`, `end_datetime` | yes | `read:cycles` |
| `recovery` | `recovery` | `start_datetime`, `end_datetime` | yes | `read:recovery` |
| `sleep` | `activity/sleep` | `start_datetime`, `end_datetime` | yes | `read:sleep` |
| `workout` | `activity/workout` | `start_datetime`, `end_datetime` | yes | `read:workout` |
| `body_measurement` | `user/measurement/body` | none | no | `read:body_measurement` |
| `profile_basic` | `user/profile/basic` | none | no | `read:profile` |

Notes specific to WHOOP's V2 API, as distinct from Oura's:

- Collection responses use a `records` array, not `data`. The CLI normalizes this to `data` in its own output for consistency with the Oura skill's shape.
- The pagination continuation token is asymmetric: a response reports it as `next_token`, but the next request must send it back as `nextToken`. The CLI handles this translation; callers of `get --all-pages` never see it.
- **Refresh tokens rotate on every use.** WHOOP invalidates the previous refresh token the moment a new one is issued. The CLI always persists whatever refresh token comes back from a refresh call; there is no option to keep reusing an old one.
- `profile_basic` is named to avoid colliding with this CLI's own `--profile` flag (the local OAuth account selector), which is an unrelated concept.
- Time ranges use full ISO 8601 datetimes (`start`/`end` upstream), not calendar dates. The `daily` command accepts `--start-date`/`--end-date` for convenience and expands them to full-day UTC bounds internally.
