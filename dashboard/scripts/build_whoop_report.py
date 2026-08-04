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


def _previous_period(start_date: str, end_date: str) -> tuple[str, str]:
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    span_days = (end - start).days + 1
    previous_end = start - timedelta(days=1)
    previous_start = previous_end - timedelta(days=span_days - 1)
    return previous_start.isoformat(), previous_end.isoformat()


def _recovery_record_date(record: dict) -> str:
    return (record.get("created_at") or "")[:10]


def fetch_report_data(profile: str, start_date: str, end_date: str) -> tuple[dict, list[dict]]:
    """Fetches everything the report needs in three WHOOP API calls, not five.

    Recovery is fetched once, spanning both the requested period and the
    equal-length period immediately before it, then split client-side by date -
    WHOOP's API only cares about the date range you ask for, so one wider range
    plus a client-side split is strictly fewer round trips than fetching each
    period separately. Sleep and workout are fetched only for the requested
    period. Cycle is never fetched at all: nothing in this report displays it,
    so the old daily-command-based fetch was pulling and discarding it for free.
    """
    previous_start, _ = _previous_period(start_date, end_date)

    recovery_payload = run_whoop(
        "get", "recovery",
        "--profile", profile,
        "--start-datetime", f"{previous_start}T00:00:00.000Z",
        "--end-datetime", f"{end_date}T23:59:59.999Z",
        "--all-pages",
    )
    all_recovery = recovery_payload.get("data", [])
    current_recovery = [r for r in all_recovery if _recovery_record_date(r) >= start_date]
    previous_recovery = [r for r in all_recovery if _recovery_record_date(r) < start_date]

    sleep_payload = run_whoop(
        "get", "sleep",
        "--profile", profile,
        "--start-datetime", f"{start_date}T00:00:00.000Z",
        "--end-datetime", f"{end_date}T23:59:59.999Z",
        "--all-pages",
    )
    workout_payload = run_whoop(
        "get", "workout",
        "--profile", profile,
        "--start-datetime", f"{start_date}T00:00:00.000Z",
        "--end-datetime", f"{end_date}T23:59:59.999Z",
        "--all-pages",
    )

    data = {
        "recovery": current_recovery,
        "sleep": sleep_payload.get("data", []),
        "workout": workout_payload.get("data", []),
    }
    return data, previous_recovery


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


def _trim_zeros(formatted: str) -> str:
    """"62.00" -> "62", "62.50" -> "62.5", "62.53" -> "62.53" - the decimal point
    is a hard stop, so this never eats into the integer part (e.g. "100.00" -> "100",
    not "1")."""
    return formatted.rstrip("0").rstrip(".") if "." in formatted else formatted


def _rounded_formatter(key: str, decimals: int) -> Callable[[dict], str]:
    def formatter(row: dict) -> str:
        value = row.get(key)
        return "—" if value is None else _trim_zeros(f"{value:.{decimals}f}")

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


def _axis_label_anchor(index: int, count: int) -> str:
    if index == 0:
        return "start"
    if index == count - 1:
        return "end"
    return "middle"


def _line_chart(
    rows: list[dict], key: str, label: str, color: str, *, trim: bool = False
) -> str:
    points = [(row["date"], row[key]) for row in rows if row.get(key) is not None]
    if not points:
        return f'<p class="empty">No {escape(label)} data to chart.</p>'

    width, height = 640, 180
    pad_left, pad_right, pad_top, pad_bottom = 44, 16, 16, 32
    plot_w = width - pad_left - pad_right
    plot_h = height - pad_top - pad_bottom
    values = [value for _, value in points]
    lo, hi = min(values), max(values)
    span = (hi - lo) or 1
    step = plot_w / max(len(points) - 1, 1)

    def tooltip_value(value: float) -> str:
        formatted = _format(value)
        return _trim_zeros(formatted) if trim else formatted

    coords = []
    for i, (_, value) in enumerate(points):
        x = pad_left + i * step
        y = pad_top + plot_h - ((value - lo) / span) * plot_h
        coords.append((x, y))

    # Y-axis: three ticks (max/mid/min) is enough to read the scale without
    # cluttering a 180px-tall chart.
    y_ticks = []
    for value in (hi, (lo + hi) / 2, lo):
        y = pad_top + plot_h - ((value - lo) / span) * plot_h
        y_ticks.append((y, tooltip_value(value)))
    gridlines = "".join(
        f'<line class="chart-gridline" x1="{pad_left}" y1="{y:.1f}" '
        f'x2="{width - pad_right}" y2="{y:.1f}" />'
        f'<text class="chart-axis-label" x="{pad_left - 8}" y="{y:.1f}" '
        f'text-anchor="end" dominant-baseline="middle">{escape(text)}</text>'
        for y, text in y_ticks
    )

    # X-axis: label the first and last point, plus the midpoint when there's
    # enough room for it not to collide with its neighbors.
    label_indices = sorted({0, len(points) - 1} | ({len(points) // 2} if len(points) > 4 else set()))
    x_labels = "".join(
        f'<text class="chart-axis-label" x="{coords[i][0]:.1f}" '
        f'y="{height - pad_bottom + 18}" text-anchor="{_axis_label_anchor(i, len(points))}">'
        f"{escape(points[i][0])}</text>"
        for i in label_indices
    )

    polyline = " ".join(f"{x:.1f},{y:.1f}" for x, y in coords)
    dots = "".join(
        f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3" fill="{color}" '
        f'data-x="{x:.1f}" data-y="{y:.1f}" data-date="{escape(date)}" '
        f'data-value="{escape(tooltip_value(value))}">'
        f"<title>{escape(date)}: {tooltip_value(value)}</title></circle>"
        for (date, value), (x, y) in zip(points, coords)
    )

    hit_area = (
        f'<rect class="chart-hit-area" x="{pad_left}" y="{pad_top}" '
        f'width="{plot_w:.1f}" height="{plot_h:.1f}" fill="transparent" />'
    )
    crosshair = (
        '<g class="chart-crosshair" style="display:none">'
        f'<line class="chart-crosshair-line" y1="{pad_top}" y2="{height - pad_bottom}" />'
        '<circle class="chart-crosshair-dot" r="5" />'
        '<g class="chart-tooltip">'
        '<rect class="chart-tooltip-bg" />'
        '<text class="chart-tooltip-date"></text>'
        '<text class="chart-tooltip-value"></text>'
        "</g></g>"
    )

    return (
        f'<svg class="chart-svg" viewBox="0 0 {width} {height}" width="100%" '
        f'height="{height}" role="img" aria-label="{escape(label)} trend">'
        f"{gridlines}{x_labels}"
        f'<polyline fill="none" stroke="{color}" stroke-width="2" points="{polyline}" />'
        f"{dots}{hit_area}{crosshair}</svg>"
    )


def _average(rows: list[dict], key: str) -> float | None:
    values = [row[key] for row in rows if row.get(key) is not None]
    if not values:
        return None
    return sum(values) / len(values)


def _rows_for_date(rows: list[dict], target_date: str) -> list[dict]:
    return [row for row in rows if row["date"] == target_date]


def _stat_tile(
    label: str,
    value: float | None,
    unit: str,
    *,
    delta: float | None = None,
    good_direction: str | None = None,
    trim: bool = False,
) -> str:
    def fmt(v: float) -> str:
        formatted = f"{v:.1f}"
        return _trim_zeros(formatted) if trim else formatted

    # No per-tile accent color on the value itself: these are independent headline
    # numbers, not comparable series, so there's no identity for hue to encode.
    display = f"{fmt(value)}{unit}" if value is not None else "—"

    delta_html = ""
    if delta is not None:
        # Base direction/judgment on the rounded (displayed) value, not the raw
        # float - a delta of -0.03 displays as "-0.0" and calling that "improved"
        # would contradict what the reader can actually see.
        rounded = round(delta, 1)
        arrow = "▲" if rounded > 0 else ("▼" if rounded < 0 else "→")
        sign = "+" if rounded > 0 else ""
        color = None
        judgment = "vs previous period"
        if good_direction in ("up", "down") and rounded != 0:
            is_good = rounded > 0 if good_direction == "up" else rounded < 0
            color = STATUS_GOOD if is_good else STATUS_SERIOUS
            judgment = "improved" if is_good else "worsened"
        text = f"{arrow} {sign}{fmt(delta)}{unit} {judgment}".strip()
        style = f' style="color:{color}"' if color else ""
        delta_html = f'<div class="stat-delta"{style}>{escape(text)}</div>'

    return (
        '<div class="stat-tile">'
        f'<div class="stat-label">{escape(label)}</div>'
        f'<div class="stat-value">{escape(display)}</div>'
        f"{delta_html}"
        "</div>"
    )


# Client-side re-implementation of the day/week/month/year aggregation used by the
# granularity filter. Ported from a version tested standalone under Node (date-bucketing
# and calendar-rollover math is exactly the kind of thing that looks right and isn't -
# see the commit message for the specific cases checked: Monday-anchored weeks grouping
# Sunday with the *preceding* Monday, and month/year rollover at year boundaries).
# No Python-side templating happens on this string - it's inserted as-is, so its own
# braces don't need doubling.
GRANULARITY_SCRIPT = """
<script>
(function () {
  var REPORT_DATA = JSON.parse(document.getElementById('report-data').textContent);
  var STATUS_GOOD = "#0ca30c";
  var STATUS_SERIOUS = "#ec835a";
  var PERIOD_LABEL = { day: "today", week: "this week", month: "this month", year: "this year" };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function mondayOf(dateStr) {
    var d = new Date(dateStr + "T00:00:00Z");
    var day = d.getUTCDay(); // 0=Sun..6=Sat
    var offset = (day + 6) % 7; // days since most recent Monday
    d.setUTCDate(d.getUTCDate() - offset);
    return d.toISOString().slice(0, 10);
  }

  function bucketKey(dateStr, granularity) {
    if (granularity === "day") return dateStr;
    if (granularity === "week") return mondayOf(dateStr);
    if (granularity === "month") return dateStr.slice(0, 7);
    return dateStr.slice(0, 4);
  }

  function previousBucketKey(anchorDateStr, granularity) {
    var d = new Date(anchorDateStr + "T00:00:00Z");
    if (granularity === "day") {
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    }
    if (granularity === "week") {
      var monday = new Date(mondayOf(anchorDateStr) + "T00:00:00Z");
      monday.setUTCDate(monday.getUTCDate() - 7);
      return monday.toISOString().slice(0, 10);
    }
    if (granularity === "month") {
      var year = d.getUTCFullYear();
      var month = d.getUTCMonth() - 1; // 0-indexed
      if (month < 0) { month = 11; year -= 1; }
      return year + "-" + String(month + 1).padStart(2, "0");
    }
    return String(d.getUTCFullYear() - 1);
  }

  function average(values) {
    var nonNull = values.filter(function (v) { return v !== null && v !== undefined; });
    if (nonNull.length === 0) return null;
    var sum = nonNull.reduce(function (a, b) { return a + b; }, 0);
    return sum / nonNull.length;
  }

  // "62.00" -> "62", "62.50" -> "62.5", "62.53" -> "62.53" - mirrors _trim_zeros
  // in the Python source exactly (same rstrip('0').rstrip('.') logic).
  function trimZeros(formatted) {
    if (formatted.indexOf(".") === -1) return formatted;
    return formatted.replace(/0+$/, "").replace(/\.$/, "");
  }

  function groupBy(rows, granularity) {
    var buckets = {};
    rows.forEach(function (row) {
      var key = bucketKey(row.date, granularity);
      (buckets[key] = buckets[key] || []).push(row);
    });
    return buckets;
  }

  function seriesFor(buckets, field) {
    return Object.keys(buckets).sort().map(function (key) {
      return { key: key, value: average(buckets[key].map(function (r) { return r[field]; })) };
    }).filter(function (p) { return p.value !== null; });
  }

  function axisLabelAnchor(index, count) {
    if (index === 0) return "start";
    if (index === count - 1) return "end";
    return "middle";
  }

  // Mirrors _line_chart in the Python source: same padding, same three-tick
  // Y-axis, same first/mid/last X-axis labels, same data-* attributes on each
  // dot so attachChartInteractivity works identically on both renderers.
  function renderLineChart(containerId, points, label, color, trim) {
    var container = document.getElementById(containerId);
    if (!points.length) {
      container.innerHTML = '<p class="empty">No ' + escapeHtml(label) + ' data to chart.</p>';
      return;
    }
    var width = 640, height = 180;
    var padLeft = 44, padRight = 16, padTop = 16, padBottom = 32;
    var plotW = width - padLeft - padRight;
    var plotH = height - padTop - padBottom;
    var values = points.map(function (p) { return p.value; });
    var lo = Math.min.apply(null, values);
    var hi = Math.max.apply(null, values);
    var span = (hi - lo) || 1;
    var step = plotW / Math.max(points.length - 1, 1);
    var coords = points.map(function (p, i) {
      var x = padLeft + i * step;
      var y = padTop + plotH - ((p.value - lo) / span) * plotH;
      return [x, y];
    });

    function tooltipValue(value) {
      var formatted = value.toFixed(2);
      return trim ? trimZeros(formatted) : formatted;
    }

    var yTicks = [hi, (lo + hi) / 2, lo].map(function (value) {
      var y = padTop + plotH - ((value - lo) / span) * plotH;
      return [y, tooltipValue(value)];
    });
    var gridlines = yTicks.map(function (tick) {
      return '<line class="chart-gridline" x1="' + padLeft + '" y1="' + tick[0].toFixed(1) +
        '" x2="' + (width - padRight) + '" y2="' + tick[0].toFixed(1) + '" />' +
        '<text class="chart-axis-label" x="' + (padLeft - 8) + '" y="' + tick[0].toFixed(1) +
        '" text-anchor="end" dominant-baseline="middle">' + escapeHtml(tick[1]) + '</text>';
    }).join("");

    var labelIndices = [0, points.length - 1];
    if (points.length > 4) labelIndices.push(Math.floor(points.length / 2));
    labelIndices = labelIndices.filter(function (v, i, arr) { return arr.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
    var xLabels = labelIndices.map(function (i) {
      return '<text class="chart-axis-label" x="' + coords[i][0].toFixed(1) + '" y="' + (height - padBottom + 18) +
        '" text-anchor="' + axisLabelAnchor(i, points.length) + '">' + escapeHtml(points[i].key) + '</text>';
    }).join("");

    var polyline = coords.map(function (c) { return c[0].toFixed(1) + "," + c[1].toFixed(1); }).join(" ");
    var dots = points.map(function (p, i) {
      var c = coords[i];
      var valueText = tooltipValue(p.value);
      return '<circle cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="3" fill="' + color + '" ' +
        'data-x="' + c[0].toFixed(1) + '" data-y="' + c[1].toFixed(1) + '" data-date="' + escapeHtml(p.key) +
        '" data-value="' + escapeHtml(valueText) + '">' +
        '<title>' + escapeHtml(p.key) + ": " + valueText + '</title></circle>';
    }).join("");

    var hitArea = '<rect class="chart-hit-area" x="' + padLeft + '" y="' + padTop + '" width="' + plotW +
      '" height="' + plotH + '" fill="transparent" />';
    var crosshair = '<g class="chart-crosshair" style="display:none">' +
      '<line class="chart-crosshair-line" y1="' + padTop + '" y2="' + (height - padBottom) + '" />' +
      '<circle class="chart-crosshair-dot" r="5" />' +
      '<g class="chart-tooltip"><rect class="chart-tooltip-bg" />' +
      '<text class="chart-tooltip-date"></text><text class="chart-tooltip-value"></text></g></g>';

    container.innerHTML = '<svg class="chart-svg" viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="' + height +
      '" role="img" aria-label="' + escapeHtml(label) + ' trend">' +
      gridlines + xLabels +
      '<polyline fill="none" stroke="' + color + '" stroke-width="2" points="' + polyline + '" />' +
      dots + hitArea + crosshair + '</svg>';
  }

  // Generic crosshair + tooltip layer, shared by both the Python-rendered
  // initial chart and every JS re-render: reads points back from the dots'
  // data-* attributes rather than needing its own copy of the chart data, so
  // it works the same regardless of which renderer produced the SVG. Defaults
  // to the latest point (on attach and whenever the pointer leaves) so the
  // reader always sees a value, not an empty chart.
  function attachChartInteractivity(containerId) {
    var container = document.getElementById(containerId);
    var svg = container && container.querySelector("svg.chart-svg");
    if (!svg) return;
    var hitArea = svg.querySelector(".chart-hit-area");
    var points = Array.prototype.slice.call(svg.querySelectorAll("circle[data-x]")).map(function (c) {
      return { x: parseFloat(c.dataset.x), y: parseFloat(c.dataset.y), date: c.dataset.date, value: c.dataset.value };
    });
    if (!hitArea || !points.length) return;

    var line = svg.querySelector(".chart-crosshair-line");
    var dot = svg.querySelector(".chart-crosshair-dot");
    var tooltipGroup = svg.querySelector(".chart-crosshair");
    var tooltipBg = svg.querySelector(".chart-tooltip-bg");
    var tooltipDate = svg.querySelector(".chart-tooltip-date");
    var tooltipValue = svg.querySelector(".chart-tooltip-value");
    var viewBoxWidth = parseFloat(svg.getAttribute("viewBox").split(" ")[2]);

    function showAt(point) {
      line.setAttribute("x1", point.x);
      line.setAttribute("x2", point.x);
      dot.setAttribute("cx", point.x);
      dot.setAttribute("cy", point.y);
      tooltipDate.textContent = point.date;
      tooltipValue.textContent = point.value;

      var boxWidth = 90, boxHeight = 34;
      var boxX = point.x + 10;
      if (boxX + boxWidth > viewBoxWidth - 4) boxX = point.x - boxWidth - 10;
      var boxY = Math.max(point.y - boxHeight - 8, 4);
      tooltipBg.setAttribute("x", boxX);
      tooltipBg.setAttribute("y", boxY);
      tooltipBg.setAttribute("width", boxWidth);
      tooltipBg.setAttribute("height", boxHeight);
      tooltipDate.setAttribute("x", boxX + 8);
      tooltipDate.setAttribute("y", boxY + 14);
      tooltipValue.setAttribute("x", boxX + 8);
      tooltipValue.setAttribute("y", boxY + 28);
      tooltipGroup.style.display = "";
    }

    function nearestPoint(svgX) {
      var nearest = points[0];
      var best = Math.abs(points[0].x - svgX);
      for (var i = 1; i < points.length; i++) {
        var d = Math.abs(points[i].x - svgX);
        if (d < best) { best = d; nearest = points[i]; }
      }
      return nearest;
    }

    function svgXFromEvent(evt) {
      var rect = svg.getBoundingClientRect();
      var scale = viewBoxWidth / rect.width;
      return (evt.clientX - rect.left) * scale;
    }

    hitArea.addEventListener("pointermove", function (evt) {
      showAt(nearestPoint(svgXFromEvent(evt)));
    });
    hitArea.addEventListener("pointerleave", function () {
      showAt(points[points.length - 1]);
    });

    showAt(points[points.length - 1]);
  }

  function renderStatTile(label, value, unit, delta, goodDirection, trim) {
    function fmt(v) {
      var formatted = v.toFixed(1);
      return trim ? trimZeros(formatted) : formatted;
    }
    var display = value === null ? "—" : fmt(value) + unit;
    var deltaHtml = "";
    if (delta !== null) {
      // Base direction/judgment on the rounded (displayed) value, not the raw
      // float - see the matching comment in _stat_tile in the Python source.
      var rounded = parseFloat(delta.toFixed(1));
      var arrow = rounded > 0 ? "▲" : (rounded < 0 ? "▼" : "→");
      var sign = rounded > 0 ? "+" : "";
      var color = null;
      var judgment = "vs previous period";
      if ((goodDirection === "up" || goodDirection === "down") && rounded !== 0) {
        var isGood = goodDirection === "up" ? rounded > 0 : rounded < 0;
        color = isGood ? STATUS_GOOD : STATUS_SERIOUS;
        judgment = isGood ? "improved" : "worsened";
      }
      var text = arrow + " " + sign + fmt(delta) + unit + " " + judgment;
      var style = color ? ' style="color:' + color + '"' : "";
      deltaHtml = '<div class="stat-delta"' + style + '>' + escapeHtml(text) + '</div>';
    }
    return '<div class="stat-tile"><div class="stat-label">' + escapeHtml(label) + '</div>' +
      '<div class="stat-value">' + escapeHtml(display) + '</div>' + deltaHtml + '</div>';
  }

  window.wellnessApplyGranularity = function (granularity) {
    var recoveryBuckets = groupBy(REPORT_DATA.recovery, granularity);
    var sleepBuckets = groupBy(REPORT_DATA.sleep, granularity);

    renderLineChart("recovery-chart", seriesFor(recoveryBuckets, "recovery_score"), "Recovery score", "#4c6ef5", true);
    renderLineChart("sleep-chart", seriesFor(sleepBuckets, "sleep_performance_percentage"), "Sleep performance %", "#f76707", false);
    attachChartInteractivity("recovery-chart");
    attachChartInteractivity("sleep-chart");

    var currentKey = bucketKey(REPORT_DATA.anchor_date, granularity);
    var previousKey = previousBucketKey(REPORT_DATA.anchor_date, granularity);
    var currentRows = recoveryBuckets[currentKey] || [];
    var previousRows = recoveryBuckets[previousKey] || [];
    var periodLabel = PERIOD_LABEL[granularity] || granularity;

    function statFor(field) {
      var current = average(currentRows.map(function (r) { return r[field]; }));
      var previous = average(previousRows.map(function (r) { return r[field]; }));
      var delta = (current !== null && previous !== null) ? current - previous : null;
      return { current: current, delta: delta };
    }

    var rhr = statFor("resting_heart_rate");
    var hrv = statFor("hrv_rmssd_milli");
    var skinTemp = statFor("skin_temp_celsius");

    document.getElementById("stat-bar").innerHTML =
      renderStatTile("Resting heart rate — " + periodLabel, rhr.current, " bpm", rhr.delta, "down", true) +
      renderStatTile("HRV — " + periodLabel, hrv.current, " ms", hrv.delta, "up", false) +
      renderStatTile("Skin temperature — " + periodLabel, skinTemp.current, " °C", skinTemp.delta, null, false);
  };

  // The "Day" view is pre-rendered by Python on page load (works with JS
  // disabled); this makes that initial chart interactive too, not just the
  // ones the granularity dropdown re-renders.
  attachChartInteractivity("recovery-chart");
  attachChartInteractivity("sleep-chart");
})();
</script>
"""


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
  .detail-toggle {{ margin-top: 1rem; }}
  .detail-toggle summary {{ cursor: pointer; font-size: 0.85rem; opacity: 0.75;
                            padding: 0.25rem 0; user-select: none; }}
  .detail-toggle summary:hover {{ opacity: 1; }}
  .detail-toggle[open] summary {{ margin-bottom: 0.25rem; }}
  .chart-svg {{ overflow: visible; }}
  .chart-gridline {{ stroke: currentColor; stroke-opacity: 0.12; stroke-width: 1; }}
  .chart-axis-label {{ font-size: 9px; fill: currentColor; opacity: 0.55; }}
  .chart-hit-area {{ cursor: crosshair; }}
  .chart-crosshair-line {{ stroke: currentColor; stroke-opacity: 0.35; stroke-width: 1; pointer-events: none; }}
  .chart-crosshair-dot {{ stroke: #16171d; stroke-width: 2; pointer-events: none; }}
  .chart-tooltip-bg {{ fill: #16171d; stroke: #2a2b33; stroke-width: 1; rx: 4; pointer-events: none; }}
  .chart-tooltip-date {{ font-size: 9px; fill: currentColor; opacity: 0.7; pointer-events: none; }}
  .chart-tooltip-value {{ font-size: 12px; font-weight: 600; fill: currentColor; pointer-events: none; }}
  @media (prefers-color-scheme: light) {{
    .chart-crosshair-dot {{ stroke: #fff; }}
    .chart-tooltip-bg {{ fill: #fff; stroke: #e2e2e2; }}
  }}
  @media (max-width: 560px) {{
    .stat-bar {{ flex-direction: column; }}
  }}
</style>
</head>
<body>
<h1>WHOOP report</h1>
<p class="meta">Profile: {profile} &middot; {start_date} to {end_date} &middot; generated locally, not uploaded anywhere</p>

<div class="filter-row">
  <label for="granularity-filter">View by</label>
  <select id="granularity-filter" onchange="wellnessApplyGranularity(this.value)">
    <option value="day" selected>Day</option>
    <option value="week">Week (Mon&ndash;Sun)</option>
    <option value="month">Month</option>
    <option value="year">Year</option>
  </select>
</div>

<div class="stat-bar" id="stat-bar">
  {stat_bar}
</div>

<div class="card">
  <h2>Recovery</h2>
  <div id="recovery-chart">{recovery_chart}</div>
  <details class="detail-toggle">
    <summary>Show details</summary>
    {recovery_table}
  </details>
</div>

<div class="card">
  <h2>Sleep</h2>
  <div id="sleep-chart">{sleep_chart}</div>
  <details class="detail-toggle">
    <summary>Show details</summary>
    {sleep_table}
  </details>
</div>

<div class="card">
  <h2>Workout</h2>
  <details class="detail-toggle">
    <summary>Show details</summary>
    {sport_filter}
    {workout_table}
    {zone_legend}
  </details>
</div>

<script type="application/json" id="report-data">{report_data_json}</script>
{granularity_script}
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
    # Chart and the granularity filter both draw from the full fetched history
    # (current + comparison period), not just the requested range - it's already
    # fetched, so showing it is free and makes the "week/month/year" filter views
    # meaningfully less sparse. The recovery *table* stays current-period-only.
    all_recovery_rows = sorted(previous_rows + recovery_rows, key=lambda row: row["date"])

    # Initial ("day" granularity, works with no JS) stat bar: today vs yesterday -
    # this matches what wellnessApplyGranularity("day") would compute client-side,
    # so re-selecting "Day" after switching away doesn't visibly change anything.
    previous_day = (date.fromisoformat(end_date) - timedelta(days=1)).isoformat()
    current_day_rows = _rows_for_date(all_recovery_rows, end_date)
    previous_day_rows = _rows_for_date(all_recovery_rows, previous_day)

    def delta_for(key: str) -> float | None:
        current = _average(current_day_rows, key)
        previous = _average(previous_day_rows, key)
        if current is None or previous is None:
            return None
        return current - previous

    stat_bar = "".join(
        [
            _stat_tile(
                "Resting heart rate — today",
                _average(current_day_rows, "resting_heart_rate"),
                " bpm",
                delta=delta_for("resting_heart_rate"),
                good_direction="down",
                trim=True,
            ),
            _stat_tile(
                "HRV — today",
                _average(current_day_rows, "hrv_rmssd_milli"),
                " ms",
                delta=delta_for("hrv_rmssd_milli"),
                good_direction="up",
            ),
            _stat_tile(
                "Skin temperature — today",
                _average(current_day_rows, "skin_temp_celsius"),
                " °C",
                delta=delta_for("skin_temp_celsius"),
                good_direction=None,  # no established "higher/lower is better" for this
            ),
        ]
    )

    report_data_json = json.dumps(
        {"anchor_date": end_date, "recovery": all_recovery_rows, "sleep": sleep_rows}
    ).replace("</", "<\\/")  # defensive: a value containing "</script>" can't break out of the tag

    return PAGE_TEMPLATE.format(
        profile=escape(profile),
        start_date=escape(start_date),
        end_date=escape(end_date),
        stat_bar=stat_bar,
        report_data_json=report_data_json,
        granularity_script=GRANULARITY_SCRIPT,
        recovery_chart=_line_chart(
            all_recovery_rows, "recovery_score", "Recovery score", "#4c6ef5", trim=True
        ),
        recovery_table=_table(
            recovery_rows,
            ["date", "recovery_score", "resting_heart_rate", "hrv_rmssd_milli", "skin_temp_celsius"],
            formatters={
                "recovery_score": _rounded_formatter("recovery_score", 2),
                "resting_heart_rate": _rounded_formatter("resting_heart_rate", 2),
            },
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
        data, previous_recovery_records = fetch_report_data(
            args.profile, args.start_date, args.end_date
        )
    except ReportError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    html = build_html(args.profile, args.start_date, args.end_date, data, previous_recovery_records)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html, encoding="utf-8")
    print(f"Wrote {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
