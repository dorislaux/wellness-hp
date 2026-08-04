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

The page has a **View by** dropdown (Day/Week/Month/Year), a stat-tile row (RHR/HRV/skin temperature for whatever's currently selected), a Recovery card (line chart + details), a Sleep card (line chart + details), and a Workout card (details only — sport filter, table, zone-effort legend).

Each card's table/filter/legend is tucked behind a collapsed **"Show details"** toggle (a native `<details>`/`<summary>`, no JS involved) so the charts are the first thing you see instead of a wall of numbers. Expand a section to get the full daily/per-workout detail; collapse it again any time. State isn't remembered across reloads — every page load starts collapsed.

`score_state` is fetched but deliberately not shown in any table — it's WHOOP's internal "is this fully scored yet" flag, not something end users need to see. `distance_meter` and `altitude_gain_meter` are hidden from the workout table because WHOOP only populates them when GPS/altitude data was actually captured (confirmed null for weightlifting-style workouts without that data) — `altitude_change_meter` has the same caveat and is currently still shown; hide it too if it's consistently null for your workout types.

Charts are hand-rolled inline SVG (no charting library, no CDN, nothing fetched at view time), plus a data table per section.

### Interactive charts

Both line charts (Recovery, Sleep) have real axes and a crosshair:

- A **Y-axis** shows three ticks (min / midpoint / max of whatever's plotted) and an **X-axis** labels the first, middle, and last dates — enough to read the scale without cluttering a small chart.
- Moving the pointer anywhere over the plot area shows a vertical crosshair that **snaps to the nearest data point** (you don't have to land precisely on a dot) and a tooltip with that point's date and value.
- The chart **defaults to showing the latest point** — on page load and every time you move the pointer off the chart — so there's always a value on screen, not an empty chart waiting for a hover. This is deliberate: readers shouldn't have to discover that hovering reveals data.
- The same detail shown in the tooltip is also reachable without hovering, in each card's table (see above) — the tooltip is a shortcut, not the only way to see a number.
- Charts rendered by the granularity filter (Week/Month/Year) get the same axes and crosshair as the initial Python-rendered "Day" chart — one shared JS function (`attachChartInteractivity`) reads the data straight back off each dot's `data-*` attributes, so it works identically regardless of which renderer (Python or JS) produced the SVG.

`recovery_score` and `resting_heart_rate` display without a trailing ".0"/".00" when the value is a whole number (e.g. "62", "55 bpm"), but keep real decimal digits when there are any (e.g. "62.5"). This applies everywhere those two fields show up — the recovery table, the stat tile, the stat-tile delta, and the recovery chart's hover tooltip — in both the Python-rendered default view and the JS-driven granularity views, kept in sync deliberately (`_trim_zeros` in Python, `trimZeros` in JS, same logic). HRV and skin temperature are intentionally untouched; ask if you want the same treatment there.

### View by: Day / Week / Month / Year

The dropdown re-aggregates the stat tiles and both line charts entirely client-side (a small inline script, no server, no refetch) — switching it doesn't touch the network. **Weeks run Monday through Sunday.** Whichever granularity is selected:

- The **stat tiles** show the average for the *current* bucket (today / this week / this month / this year — anchored to the report's `--end-date`, not your browser's clock, so a report opened days after it was generated still means what it meant when generated) compared against the immediately preceding bucket of the same kind (yesterday / last week / last calendar month / last calendar year — real calendar boundaries, e.g. the "previous bucket" for January is December of the *prior* year, not "31 days back").
- The **charts** re-bucket every fetched recovery/sleep day into that granularity and plot one point per bucket. Week/month/year views are only as populated as the data actually fetched supports — if you only ask for a week of dates, the "Month" and "Year" views will have very few points. There's no live re-fetching once the file is generated; the filter reshapes what's already there, it doesn't fetch more.
- **This changed the default "Day" view too**, not just the new granularities: the stat tiles now show *today's* single-day value (compared to yesterday), not an average across the whole requested range like before. The Recovery chart also now plots the comparison period's days in addition to the requested range (that data was already being fetched for the delta; previously it just wasn't drawn) — so "Day" shows more history than it used to.
- The **tables and the Workout section are unaffected by this filter** — they always show full daily/per-workout detail regardless of what's selected up top. Only the stat bar and the two line charts respond to it.

Page loads in the "Day" state pre-rendered by Python (works even with JavaScript disabled); the dropdown only takes over once you actually change it, and reuses the exact same markup/CSS classes so there's no visual jump between the two.

### Stat-tile deltas (period-over-period comparison)

Each stat tile's delta is colored by whether that direction is actually good for the specific metric, not a generic up-good/down-bad assumption:

- **RHR**: lower is better → a decrease is colored green ("improved"), an increase is orange ("worsened").
- **HRV**: higher is better → the same colors, opposite direction.
- **Skin temperature**: shown with no color judgment at all, deliberately. There's no established "higher is always better" or "lower is always better" for skin temperature — a deviation in either direction can just mean normal variation, or could be a signal worth attention. Color-coding it green/orange would be asserting a health claim this project has no basis for. The delta number is still shown, just neutral.

Colors are the dataviz skill's reserved status tokens (`#0ca30c` good / `#ec835a` serious), never used as the categorical/chart palette, and always paired with a direction arrow and a word ("improved"/"worsened") — never color alone. Direction/color is based on the *rounded, displayed* value, not the raw float — a delta of -0.03 displays as "-0.0" and would read as a false "improved"/"worsened" claim otherwise. If the comparison bucket has no data (e.g. account too new, or the fetched range doesn't reach back far enough for the selected granularity), the delta line simply doesn't render for that tile; the report doesn't fail.

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
