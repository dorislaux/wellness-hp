#!/usr/bin/env python3
"""Build a self-contained local HTML report from WHOOP data.

Fetches data by running the whoop skill's CLI as a subprocess (never imports its
internals directly, and never touches OAuth or token storage itself — those stay
inside whoop/scripts/whoop.py, per dashboard/README.md's stated scope) and renders
the fields selected in whoop/references/endpoints.md into a single HTML file with
no external network dependency: no CDN scripts, no fonts, nothing fetched at
view time. Open the output file directly in a browser; nothing is uploaded anywhere.
"""

from __future__ import annotations

import argparse
from datetime import date, timedelta
from html import escape
import json
from pathlib import Path
import subprocess
import sys
from typing import Callable, Mapping

REPO_ROOT = Path(__file__).resolve().parents[2]
WHOOP_CLI = REPO_ROOT / "whoop" / "scripts" / "whoop.py"

ZONE_KEYS = (
    "zone_zero_milli", "zone_one_milli", "zone_two_milli",
    "zone_three_milli", "zone_four_milli", "zone_five_milli",
)

# Reserved status colors (dataviz skill's palette.md) - not the categorical/sequential
# palette. Only good/serious are used here; delta always ships with an icon-ish arrow
# and a "improved"/"worsened" word, never color alone.
STATUS_GOOD = "#0ca30c"
STATUS_SERIOUS = "#ec835a"


class ReportError(RuntimeError):
    """Raised when the report can't be built."""


def run_whoop(*args: str) -> dict:
    result = subprocess.run(
        [sys.executable, str(WHOOP_CLI), *args],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise ReportError(
            f"whoop.py {' '.join(args)} failed: {result.stderr.strip() or result.stdout.strip()}"
        )
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ReportError(f"whoop.py {' '.join(args)} returned non-JSON output.") from exc


def fetch_data(profile: str, start_date: str, end_date: str) -> dict:
    daily = run_whoop(
        "daily",
        "--profile", profile,
        "--start-date", start_date,
        "--end-date", end_date,
    )
    workouts = run_whoop(
        "get", "workout",
        "--profile", profile,
        "--start-datetime", f"{start_date}T00:00:00.000Z",
        "--end-datetime", f"{end_date}T23:59:59.999Z",
        "--all-pages",
    )
    return {
        "recovery": daily.get("recovery", []),
        "sleep": daily.get("sleep", []),
        "workout": workouts.get("data", []),
    }


def _previous_period(start_date: str, end_date: str) -> tuple[str, str]:
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    span_days = (end - start).days + 1
    previous_end = start - timedelta(days=1)
    previous_start = previous_end - timedelta(days=span_days - 1)
    return previous_start.isoformat(), previous_end.isoformat()


def fetch_previous_recovery(profile: str, start_date: str, end_date: str) -> list[dict]:
    """Fetches recovery for the period immediately preceding, same length as the
    requested range - so a comparison always means "vs the equivalent prior period",
    not hardcoded to any specific number of days."""
    previous_start, previous_end = _previous_period(start_date, end_date)
    payload = run_whoop(
        "get", "recovery",
        "--profile", profile,
        "--start-datetime", f"{previous_start}T00:00:00.000Z",
        "--end-datetime", f"{previous_end}T23:59:59.999Z",
        "--all-pages",
    )
    return payload.get("data", [])


def extract_recovery(records: list[dict]) -> list[dict]:
    rows = []
    for record in records:
        score = record.get("score") or {}
        rows.append(
            {
                "date": (record.get("created_at") or "")[:10],
                "recovery_score": score.get("recovery_score"),
                "resting_heart_rate": score.get("resting_heart_rate"),
                "hrv_rmssd_milli": score.get("hrv_rmssd_milli"),
                "skin_temp_celsius": score.get("skin_temp_celsius"),
            }
        )
    rows.sort(key=lambda row: row["date"])
    return rows


def extract_sleep(records: list[dict]) -> list[dict]:
    rows = []
    for record in records:
        score = record.get("score") or {}
        rows.append(
            {
                "date": (record.get("start") or "")[:10],
                "nap": record.get("nap"),
                "sleep_performance_percentage": score.get("sleep_performance_percentage"),
                "sleep_efficiency_percentage": score.get("sleep_efficiency_percentage"),
                "sleep_consistency_percentage": score.get("sleep_consistency_percentage"),
            }
        )
    rows.sort(key=lambda row: row["date"])
    return rows


def extract_workout(records: list[dict]) -> list[dict]:
    rows = []
    for record in records:
        score = record.get("score") or {}
        zones = score.get("zone_durations") or {}
        rows.append(
            {
                "date": (record.get("start") or "")[:10],
                "sport_name": record.get("sport_name"),
                "start": record.get("start"),
                "end": record.get("end"),
                "score_state": record.get("score_state"),
                "strain": score.get("strain"),
                "average_heart_rate": score.get("average_heart_rate"),
                "max_heart_rate": score.get("max_heart_rate"),
                "kilojoule": score.get("kilojoule"),
                "percent_recorded": score.get("percent_recorded"),
                "distance_meter": score.get("distance_meter"),
                "altitude_gain_meter": score.get("altitude_gain_meter"),
                "altitude_change_meter": score.get("altitude_change_meter"),
                "zone_zero_milli": zones.get("zone_zero_milli"),
                "zone_one_milli": zones.get("zone_one_milli"),
                "zone_two_milli": zones.get("zone_two_milli"),
                "zone_three_milli": zones.get("zone_three_milli"),
                "zone_four_milli": zones.get("zone_four_milli"),
                "zone_five_milli": zones.get("zone_five_milli"),
            }
        )
    rows.sort(key=lambda row: row["date"])
    return rows


def _format(value: object) -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:.2f}"
    return escape(str(value))


def _percent_formatter(key: str) -> Callable[[dict], str]:
    def formatter(row: dict) -> str:
        value = row.get(key)
        return "—" if value is None else f"{value:.0f}%"

    return formatter


def _zone_bar(row: dict) -> str:
    values = [row.get(key) or 0 for key in ZONE_KEYS]
    total = sum(values)
    if total <= 0:
        return '<span class="empty">No zone data</span>'

    width, height, gap = 160, 16, 2
    clip_id = f"zoneclip-{id(row)}"
    segments = []
    x = 0.0
    for i, v in enumerate(values):
        seg_w = (v / total) * width
        draw_w = max(seg_w - gap, 0.0) if v > 0 else 0.0
        if draw_w > 0:
            minutes = v / 60000
            segments.append(
                f'<rect x="{x:.1f}" y="0" width="{draw_w:.1f}" height="{height}" '
                f'fill="var(--zone-{i})"><title>Zone {i}: {minutes:.0f} min</title></rect>'
            )
        x += seg_w
    return (
        f'<svg viewBox="0 0 {width} {height}" width="{width}" height="{height}" '
        f'role="img" aria-label="Heart rate zone breakdown">'
        f'<clipPath id="{clip_id}"><rect width="{width}" height="{height}" rx="4"/></clipPath>'
        f'<g clip-path="url(#{clip_id})">{"".join(segments)}</g>'
        f"</svg>"
    )


ZONE_LEGEND = (
    '<div class="zone-legend">'
    '<span class="zone-legend-label">Effort zones</span>'
    + "".join(
        f'<span class="zone-swatch" style="background:var(--zone-{i})"></span>' for i in range(6)
    )
    + '<span class="zone-legend-caption">0 (light) &rarr; 5 (max)</span>'
    "</div>"
)


def _sport_filter(rows: list[dict]) -> str:
    sports = sorted({row["sport_name"] for row in rows if row.get("sport_name")})
    if not sports:
        return ""
    options = '<option value="">All sports</option>' + "".join(
        f'<option value="{escape(sport)}">{escape(sport)}</option>' for sport in sports
    )
    return (
        '<div class="filter-row">'
        '<label for="sport-filter">Sport</label>'
        f'<select id="sport-filter" onchange="wellnessFilterSport(this.value)">{options}</select>'
        "</div>"
        "<script>"
        "function wellnessFilterSport(value) {"
        "  document.querySelectorAll('#workout-table tbody tr').forEach(function(tr) {"
        "    tr.style.display = (!value || tr.dataset.sport === value) ? '' : 'none';"
        "  });"
        "}"
        "</script>"
    )


def _table(
    rows: list[dict],
    columns: list[str],
    *,
    formatters: Mapping[str, Callable[[dict], str]] | None = None,
    row_attrs: Callable[[dict], str] | None = None,
    table_id: str | None = None,
) -> str:
    if not rows:
        return "<p class=\"empty\">No data in this range.</p>"
    formatters = formatters or {}
    id_attr = f' id="{escape(table_id)}"' if table_id else ""
    header = "".join(f"<th>{escape(col)}</th>" for col in columns)
    body_rows = []
    for row in rows:
        attrs = row_attrs(row) if row_attrs else ""
        cells = []
        for col in columns:
            if col in formatters:
                cells.append(f"<td>{formatters[col](row)}</td>")
            else:
                cells.append(f"<td>{_format(row.get(col))}</td>")
        body_rows.append(f"<tr{attrs}>{''.join(cells)}</tr>")
    return (
        f'<table{id_attr}><thead><tr>{header}</tr></thead>'
        f'<tbody>{"".join(body_rows)}</tbody></table>'
    )


def _line_chart(rows: list[dict], key: str, label: str, color: str) -> str:
    points = [(row["date"], row[key]) for row in rows if row.get(key) is not None]
    if not points:
        return f'<p class="empty">No {escape(label)} data to chart.</p>'

    width, height, padding = 640, 160, 28
    plot_w = width - 2 * padding
    plot_h = height - 2 * padding
    values = [value for _, value in points]
    lo, hi = min(values), max(values)
    span = (hi - lo) or 1
    step = plot_w / max(len(points) - 1, 1)

    coords = []
    for i, (_, value) in enumerate(points):
        x = padding + i * step
        y = padding + plot_h - ((value - lo) / span) * plot_h
        coords.append((x, y))

    polyline = " ".join(f"{x:.1f},{y:.1f}" for x, y in coords)
    dots = "".join(
        f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3" fill="{color}">'
        f"<title>{escape(date)}: {_format(value)}</title></circle>"
        for (date, value), (x, y) in zip(points, coords)
    )
    return (
        f'<svg viewBox="0 0 {width} {height}" width="100%" height="{height}" '
        f'role="img" aria-label="{escape(label)} trend">'
        f'<polyline fill="none" stroke="{color}" stroke-width="2" points="{polyline}" />'
        f"{dots}</svg>"
    )


def _average(rows: list[dict], key: str) -> float | None:
    values = [row[key] for row in rows if row.get(key) is not None]
    if not values:
        return None
    return sum(values) / len(values)


def _stat_tile(
    label: str,
    value: float | None,
    unit: str,
    *,
    delta: float | None = None,
    good_direction: str | None = None,
) -> str:
    # No per-tile accent color on the value itself: these are independent headline
    # numbers, not comparable series, so there's no identity for hue to encode.
    display = f"{value:.1f}{unit}" if value is not None else "—"

    delta_html = ""
    if delta is not None:
        arrow = "▲" if delta > 0 else ("▼" if delta < 0 else "→")
        sign = "+" if delta > 0 else ""
        color = None
        judgment = "vs previous period"
        if good_direction in ("up", "down") and delta != 0:
            is_good = delta > 0 if good_direction == "up" else delta < 0
            color = STATUS_GOOD if is_good else STATUS_SERIOUS
            judgment = "improved" if is_good else "worsened"
        text = f"{arrow} {sign}{delta:.1f}{unit} {judgment}".strip()
        style = f' style="color:{color}"' if color else ""
        delta_html = f'<div class="stat-delta"{style}>{escape(text)}</div>'

    return (
        '<div class="stat-tile">'
        f'<div class="stat-label">{escape(label)}</div>'
        f'<div class="stat-value">{escape(display)}</div>'
        f"{delta_html}"
        "</div>"
    )


PAGE_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>WHOOP report — {profile}</title>
<style>
  :root {{
    --zone-0: #cde2fb; --zone-1: #9ec5f4; --zone-2: #6da7ec;
    --zone-3: #3987e5; --zone-4: #256abf; --zone-5: #184f95;
  }}
  @media (prefers-color-scheme: light) {{
    :root {{
      --zone-0: #86b6ef; --zone-1: #5598e7; --zone-2: #2a78d6;
      --zone-3: #1c5cab; --zone-4: #104281; --zone-5: #0d366b;
    }}
  }}
  body {{ font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 2rem;
         background: #0b0c10; color: #e8e8ea; }}
  @media (prefers-color-scheme: light) {{
    body {{ background: #fafafa; color: #1a1a1a; }}
    table {{ background: #fff; }}
    .card, .stat-tile {{ background: #fff; border: 1px solid #e2e2e2; }}
    .filter-row select {{ border: 1px solid #e2e2e2; background: #fff; }}
  }}
  h1 {{ font-size: 1.4rem; margin-bottom: 0.25rem; }}
  .meta {{ opacity: 0.7; margin-bottom: 1.5rem; font-size: 0.9rem; }}
  .card {{ background: #16171d; border: 1px solid #2a2b33; border-radius: 10px;
           padding: 1.25rem 1.5rem; margin-bottom: 1.75rem; }}
  h2 {{ font-size: 1.1rem; margin-top: 0; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 1rem; }}
  th, td {{ text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #2a2b33; }}
  th {{ opacity: 0.7; font-weight: 600; }}
  .empty {{ opacity: 0.6; font-style: italic; }}
  .stat-bar {{ display: flex; gap: 1rem; margin-bottom: 1.75rem; }}
  .stat-tile {{ flex: 1; background: #16171d; border: 1px solid #2a2b33; border-radius: 10px;
                padding: 1rem 1.25rem; }}
  .stat-label {{ opacity: 0.7; font-size: 0.8rem; margin-bottom: 0.35rem; }}
  .stat-value {{ font-size: 1.6rem; font-weight: 600; }}
  .stat-delta {{ font-size: 0.8rem; margin-top: 0.35rem; opacity: 0.9; }}
  .zone-legend {{ display: flex; align-items: center; gap: 0.4rem; margin-top: 0.75rem;
                  font-size: 0.8rem; opacity: 0.85; }}
  .zone-legend-label {{ opacity: 0.7; margin-right: 0.25rem; }}
  .zone-swatch {{ width: 12px; height: 12px; border-radius: 2px; display: inline-block; }}
  .zone-legend-caption {{ opacity: 0.7; margin-left: 0.35rem; }}
  .filter-row {{ margin-bottom: 0.75rem; font-size: 0.85rem; }}
  .filter-row label {{ margin-right: 0.5rem; opacity: 0.7; }}
  .filter-row select {{ font: inherit; padding: 0.25rem 0.5rem; border-radius: 6px;
                        border: 1px solid #2a2b33; background: #16171d; color: inherit; }}
  @media (max-width: 560px) {{
    .stat-bar {{ flex-direction: column; }}
  }}
</style>
</head>
<body>
<h1>WHOOP report</h1>
<p class="meta">Profile: {profile} &middot; {start_date} to {end_date} &middot; generated locally, not uploaded anywhere</p>

<div class="stat-bar">
  {stat_bar}
</div>

<div class="card">
  <h2>Recovery</h2>
  {recovery_chart}
  {recovery_table}
</div>

<div class="card">
  <h2>Sleep</h2>
  {sleep_chart}
  {sleep_table}
</div>

<div class="card">
  <h2>Workout</h2>
  {sport_filter}
  {workout_table}
  {zone_legend}
</div>
</body>
</html>
"""


def build_html(
    profile: str,
    start_date: str,
    end_date: str,
    data: dict,
    previous_recovery_records: list[dict] | None = None,
) -> str:
    recovery_rows = extract_recovery(data["recovery"])
    sleep_rows = extract_sleep(data["sleep"])
    workout_rows = extract_workout(data["workout"])
    previous_rows = extract_recovery(previous_recovery_records or [])

    def delta_for(key: str) -> float | None:
        current = _average(recovery_rows, key)
        previous = _average(previous_rows, key)
        if current is None or previous is None:
            return None
        return current - previous

    stat_bar = "".join(
        [
            _stat_tile(
                "Average resting heart rate",
                _average(recovery_rows, "resting_heart_rate"),
                " bpm",
                delta=delta_for("resting_heart_rate"),
                good_direction="down",
            ),
            _stat_tile(
                "Average HRV",
                _average(recovery_rows, "hrv_rmssd_milli"),
                " ms",
                delta=delta_for("hrv_rmssd_milli"),
                good_direction="up",
            ),
            _stat_tile(
                "Average skin temperature",
                _average(recovery_rows, "skin_temp_celsius"),
                " °C",
                delta=delta_for("skin_temp_celsius"),
                good_direction=None,  # no established "higher/lower is better" for this
            ),
        ]
    )

    return PAGE_TEMPLATE.format(
        profile=escape(profile),
        start_date=escape(start_date),
        end_date=escape(end_date),
        stat_bar=stat_bar,
        recovery_chart=_line_chart(recovery_rows, "recovery_score", "Recovery score", "#4c6ef5"),
        recovery_table=_table(
            recovery_rows,
            ["date", "recovery_score", "resting_heart_rate", "hrv_rmssd_milli", "skin_temp_celsius"],
        ),
        sleep_chart=_line_chart(
            sleep_rows, "sleep_performance_percentage", "Sleep performance %", "#f76707"
        ),
        sleep_table=_table(
            sleep_rows,
            [
                "date", "nap",
                "sleep_performance_percentage", "sleep_efficiency_percentage", "sleep_consistency_percentage",
            ],
            formatters={
                "sleep_performance_percentage": _percent_formatter("sleep_performance_percentage"),
                "sleep_efficiency_percentage": _percent_formatter("sleep_efficiency_percentage"),
                "sleep_consistency_percentage": _percent_formatter("sleep_consistency_percentage"),
            },
        ),
        sport_filter=_sport_filter(workout_rows),
        workout_table=_table(
            workout_rows,
            [
                "date", "sport_name", "strain", "average_heart_rate", "max_heart_rate",
                "kilojoule", "percent_recorded", "altitude_change_meter", "zones",
            ],
            formatters={
                "percent_recorded": _percent_formatter("percent_recorded"),
                "zones": _zone_bar,
            },
            row_attrs=lambda row: f' data-sport="{escape(str(row.get("sport_name") or ""))}"',
            table_id="workout-table",
        ),
        zone_legend=ZONE_LEGEND if workout_rows else "",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a local HTML report from WHOOP data")
    parser.add_argument("--profile", default="default")
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", required=True)
    parser.add_argument(
        "--output",
        default=str(REPO_ROOT / "dashboard" / "output" / "whoop-report.html"),
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        data = fetch_data(args.profile, args.start_date, args.end_date)
    except ReportError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    try:
        previous_recovery_records = fetch_previous_recovery(
            args.profile, args.start_date, args.end_date
        )
    except ReportError as exc:
        print(
            f"Warning: could not fetch previous-period data for comparison: {exc}",
            file=sys.stderr,
        )
        previous_recovery_records = []

    html = build_html(args.profile, args.start_date, args.end_date, data, previous_recovery_records)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html, encoding="utf-8")
    print(f"Wrote {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
