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
from html import escape
import json
from pathlib import Path
import subprocess
import sys

REPO_ROOT = Path(__file__).resolve().parents[2]
WHOOP_CLI = REPO_ROOT / "whoop" / "scripts" / "whoop.py"


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


def extract_recovery(records: list[dict]) -> list[dict]:
    rows = []
    for record in records:
        score = record.get("score") or {}
        rows.append(
            {
                "date": (record.get("created_at") or "")[:10],
                "score_state": record.get("score_state"),
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
                "score_state": record.get("score_state"),
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


def _table(rows: list[dict], columns: list[str]) -> str:
    if not rows:
        return "<p class=\"empty\">No data in this range.</p>"
    header = "".join(f"<th>{escape(col)}</th>" for col in columns)
    body_rows = []
    for row in rows:
        cells = "".join(f"<td>{_format(row.get(col))}</td>" for col in columns)
        body_rows.append(f"<tr>{cells}</tr>")
    return (
        f'<table><thead><tr>{header}</tr></thead><tbody>{"".join(body_rows)}</tbody></table>'
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


PAGE_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>WHOOP report — {profile}</title>
<style>
  body {{ font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 2rem;
         background: #0b0c10; color: #e8e8ea; }}
  @media (prefers-color-scheme: light) {{
    body {{ background: #fafafa; color: #1a1a1a; }}
    table {{ background: #fff; }}
    .card {{ background: #fff; border: 1px solid #e2e2e2; }}
  }}
  h1 {{ font-size: 1.4rem; margin-bottom: 0.25rem; }}
  .meta {{ opacity: 0.7; margin-bottom: 2rem; font-size: 0.9rem; }}
  .card {{ background: #16171d; border: 1px solid #2a2b33; border-radius: 10px;
           padding: 1.25rem 1.5rem; margin-bottom: 1.75rem; }}
  h2 {{ font-size: 1.1rem; margin-top: 0; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 1rem; }}
  th, td {{ text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #2a2b33; }}
  th {{ opacity: 0.7; font-weight: 600; }}
  .empty {{ opacity: 0.6; font-style: italic; }}
</style>
</head>
<body>
<h1>WHOOP report</h1>
<p class="meta">Profile: {profile} &middot; {start_date} to {end_date} &middot; generated locally, not uploaded anywhere</p>

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
  {workout_table}
</div>
</body>
</html>
"""


def build_html(profile: str, start_date: str, end_date: str, data: dict) -> str:
    recovery_rows = extract_recovery(data["recovery"])
    sleep_rows = extract_sleep(data["sleep"])
    workout_rows = extract_workout(data["workout"])

    return PAGE_TEMPLATE.format(
        profile=escape(profile),
        start_date=escape(start_date),
        end_date=escape(end_date),
        recovery_chart=_line_chart(recovery_rows, "recovery_score", "Recovery score", "#4c6ef5"),
        recovery_table=_table(
            recovery_rows,
            ["date", "score_state", "recovery_score", "resting_heart_rate", "hrv_rmssd_milli", "skin_temp_celsius"],
        ),
        sleep_chart=_line_chart(
            sleep_rows, "sleep_performance_percentage", "Sleep performance %", "#f76707"
        ),
        sleep_table=_table(
            sleep_rows,
            [
                "date", "nap", "score_state",
                "sleep_performance_percentage", "sleep_efficiency_percentage", "sleep_consistency_percentage",
            ],
        ),
        workout_table=_table(
            workout_rows,
            [
                "date", "sport_name", "score_state", "strain", "average_heart_rate", "max_heart_rate",
                "kilojoule", "percent_recorded", "distance_meter",
                "altitude_gain_meter", "altitude_change_meter",
                "zone_zero_milli", "zone_one_milli", "zone_two_milli",
                "zone_three_milli", "zone_four_milli", "zone_five_milli",
            ],
        ),
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
        html = build_html(args.profile, args.start_date, args.end_date, data)
    except ReportError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html, encoding="utf-8")
    print(f"Wrote {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
