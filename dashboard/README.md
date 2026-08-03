# Dashboard

Local-only reporting built on top of the `oura/` and `whoop/` provider skills. There is no server and nothing is uploaded anywhere — a script fetches data by running a provider skill's CLI as a subprocess, then writes a self-contained HTML file to `dashboard/output/` (gitignored) for you to open in your own browser.

## What's built: `build_whoop_report.py`

```bash
python3 dashboard/scripts/build_whoop_report.py --start-date 2026-07-27 --end-date 2026-08-03
```

Requires the `whoop` skill to already be `configure`d and `authorize`d for the profile you're using (`--profile default` if omitted) — this script never touches OAuth itself, it only runs `whoop/scripts/whoop.py` as a subprocess and reads its JSON output. Writes to `dashboard/output/whoop-report.html` by default (`--output` to change it).

Pulls only the fields decided in [`whoop/references/endpoints.md`](../whoop/references/endpoints.md#fields-selected-for-this-project):
- **Recovery**: `recovery_score`, `resting_heart_rate`, `hrv_rmssd_milli`, `skin_temp_celsius`
- **Sleep**: `sleep_performance_percentage`, `sleep_efficiency_percentage`, `sleep_consistency_percentage`
- **Workout**: everything

Charts are hand-rolled inline SVG (no charting library, no CDN, nothing fetched at view time), plus a data table per section.

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
