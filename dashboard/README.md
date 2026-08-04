# Dashboard

Local-only reporting built on top of the `oura/` and `whoop/` provider skills. There is no server and nothing is uploaded anywhere — a script fetches data by running a provider skill's CLI as a subprocess, then writes a self-contained HTML file to `dashboard/output/` (gitignored) for you to open in your own browser.

## What's built: `build_whoop_report.py`

```bash
python3 dashboard/scripts/build_whoop_report.py --start-date 2026-07-27 --end-date 2026-08-03
```

Requires the `whoop` skill to already be `configure`d and `authorize`d for the profile you're using (`--profile default` if omitted) — this script never touches OAuth itself, it only runs `whoop/scripts/whoop.py` as a subprocess and reads its JSON output. Writes to `dashboard/output/whoop-report.html` by default (`--output` to change it).

Fetches in exactly three WHOOP API calls: recovery (one call spanning both the requested period and the equal-length period immediately before it, for the stat-tile deltas — split by date client-side, not two separate calls), sleep, and workout, all scoped to the requested range. No `daily` command and no cycle data at all — nothing in this report displays cycle, so fetching it would just be waste.

Pulls only the fields decided in [`whoop/references/endpoints.md`](../whoop/references/endpoints.md#fields-selected-for-this-project):
- **Recovery**: `recovery_score`, `resting_heart_rate`, `hrv_rmssd_milli`, `skin_temp_celsius`
- **Sleep**: `sleep_performance_percentage`, `sleep_efficiency_percentage`, `sleep_consistency_percentage`
- **Workout**: everything (fetched in full; a couple of always-null columns are hidden from the table itself, see below)

The page has a stat-tile row at the top (averages of RHR, HRV, and skin temperature over whatever `--start-date`/`--end-date` range was requested — not hardcoded to 7 days, though that's the typical usage), a Recovery card (line chart + table), a Sleep card (line chart + table), and a Workout card (a sport filter, a table, and a zone-effort legend).

`score_state` is fetched but deliberately not shown in any table — it's WHOOP's internal "is this fully scored yet" flag, not something end users need to see. `distance_meter` and `altitude_gain_meter` are hidden from the workout table because WHOOP only populates them when GPS/altitude data was actually captured (confirmed null for weightlifting-style workouts without that data) — `altitude_change_meter` has the same caveat and is currently still shown; hide it too if it's consistently null for your workout types.

Charts are hand-rolled inline SVG (no charting library, no CDN, nothing fetched at view time), plus a data table per section.

### Stat-tile deltas (period-over-period comparison)

Each stat tile compares against the immediately preceding period of equal length (e.g. requesting `2026-07-27` to `2026-08-03` also covers `2026-07-19` to `2026-07-26` for comparison) and shows the change, color-coded by whether that direction is actually good for that metric. This doesn't cost an extra API call: the single recovery fetch already spans both periods, split by date after the fact.

- **RHR**: lower is better → a decrease is colored green ("improved"), an increase is orange ("worsened").
- **HRV**: higher is better → the same colors, opposite direction.
- **Skin temperature**: shown with no color judgment at all, deliberately. There's no established "higher is always better" or "lower is always better" for skin temperature — a deviation in either direction can just mean normal variation, or could be a signal worth attention. Color-coding it green/orange would be asserting a health claim this project has no basis for. The delta number is still shown, just neutral.

Colors are the dataviz skill's reserved status tokens (`#0ca30c` good / `#ec835a` serious), never used as the categorical/chart palette, and always paired with a direction arrow and a word ("improved"/"worsened") — never color alone. If the previous period has no data (e.g. account too new), the delta line simply doesn't render for that tile; the report doesn't fail.

### Zone breakdown

The six `zone_*_milli` fields render as one horizontal stacked bar per workout instead of six raw-millisecond columns, using a single-hue ordinal ramp (light = zone 0, dark = zone 5 — intensity is inherently ordered, so this isn't a categorical/identity color choice). Hover a segment for the exact minutes. A shared legend above the table explains the scale once, rather than per row.

### Sport filter

A dropdown above the workout table lists every distinct `sport_name` present; selecting one hides non-matching rows via a small inline script (no external JS, still a single self-contained file).

## Not built yet

- **Oura data / cross-provider pooling.** Today's report is Whoop-only. Pooling RHR/HRV/skin temperature against Oura's equivalents (recovery score is deliberately kept separate — different methodology, never averaged, see `whoop/references/endpoints.md`) is the next step, not yet done.
- **Multi-person comparison.** Everything here assumes one profile. Comparing people must keep every metric labeled by person and provider — never merge two people's numbers.

## Explicitly out of scope, permanently

- OAuth and token storage stay inside each provider skill (`~/.config/oura`, `~/.config/whoop`). This directory only ever consumes already-authorized data by calling a provider's CLI; it must never read a provider's token files directly or duplicate its credential handling.
- A hosted/shared version of this report. It's a local file you open yourself; that's a deliberate privacy choice (see `../PRIVACY.md`), not a placeholder for "not built yet."

## Tests

```bash
python3 -m unittest dashboard/scripts/test_build_whoop_report.py
```

Mocks the `whoop.py` subprocess call entirely — no credentials or network needed to run the test suite.
