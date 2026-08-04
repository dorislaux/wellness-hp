from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

SCRIPT_PATH = Path(__file__).with_name("build_whoop_report.py")
SPEC = importlib.util.spec_from_file_location("build_whoop_report", SCRIPT_PATH)
assert SPEC and SPEC.loader
report = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = report
SPEC.loader.exec_module(report)


def stat_bar_html(html: str) -> str:
    """The page now embeds the granularity-filter JS source as page text, and that
    source contains string literals ("stat-delta", "recovery_score", "improved", ...)
    that collide with plain substring checks meant to test *rendered* output. Tests
    that care specifically about the pre-rendered stat bar must scope to this slice,
    not the whole page, or they'd pass even if the actual rendered stat bar were wrong."""
    start = html.index('<div class="stat-bar" id="stat-bar">')
    end = html.index('<div class="card">', start)
    return html[start:end]


class ExtractionTests(unittest.TestCase):
    def test_extract_recovery_pulls_only_selected_fields(self) -> None:
        records = [
            {
                "created_at": "2026-07-28T07:00:00.000Z",
                "score_state": "SCORED",
                "score": {
                    "recovery_score": 62.0,
                    "resting_heart_rate": 54.0,
                    "hrv_rmssd_milli": 45.2,
                    "skin_temp_celsius": 33.4,
                    "spo2_percentage": 96.0,  # deliberately not selected for this project
                },
            }
        ]
        rows = report.extract_recovery(records)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["date"], "2026-07-28")
        self.assertEqual(row["recovery_score"], 62.0)
        self.assertEqual(row["resting_heart_rate"], 54.0)
        self.assertEqual(row["hrv_rmssd_milli"], 45.2)
        self.assertEqual(row["skin_temp_celsius"], 33.4)
        self.assertNotIn("spo2_percentage", row)

    def test_extract_sleep_pulls_only_three_percentages(self) -> None:
        records = [
            {
                "start": "2026-07-28T23:00:00.000Z",
                "nap": False,
                "score_state": "SCORED",
                "score": {
                    "sleep_performance_percentage": 88.0,
                    "sleep_efficiency_percentage": 91.2,
                    "sleep_consistency_percentage": 76.0,
                    "respiratory_rate": 16.1,  # deliberately not selected
                    "stage_summary": {"total_in_bed_time_milli": 1000},  # deliberately not selected
                },
            }
        ]
        rows = report.extract_sleep(records)
        row = rows[0]
        self.assertEqual(row["sleep_performance_percentage"], 88.0)
        self.assertNotIn("respiratory_rate", row)
        self.assertNotIn("stage_summary", row)

    def test_extract_workout_pulls_everything(self) -> None:
        records = [
            {
                "start": "2026-07-28T18:00:00.000Z",
                "end": "2026-07-28T19:00:00.000Z",
                "sport_name": "running",
                "score_state": "SCORED",
                "score": {
                    "strain": 12.4,
                    "average_heart_rate": 142,
                    "max_heart_rate": 168,
                    "kilojoule": 2100.5,
                    "percent_recorded": 100.0,
                    "distance_meter": 8300.0,
                    "altitude_gain_meter": 45.0,
                    "altitude_change_meter": 2.0,
                    "zone_durations": {
                        "zone_zero_milli": 1,
                        "zone_one_milli": 2,
                        "zone_two_milli": 3,
                        "zone_three_milli": 4,
                        "zone_four_milli": 5,
                        "zone_five_milli": 6,
                    },
                },
            }
        ]
        row = report.extract_workout(records)[0]
        self.assertEqual(row["sport_name"], "running")
        self.assertEqual(row["strain"], 12.4)
        self.assertEqual(row["zone_five_milli"], 6)

    def test_rows_are_sorted_by_date(self) -> None:
        records = [
            {"created_at": "2026-07-29T00:00:00Z", "score": {"recovery_score": 1}},
            {"created_at": "2026-07-27T00:00:00Z", "score": {"recovery_score": 2}},
        ]
        rows = report.extract_recovery(records)
        self.assertEqual([row["date"] for row in rows], ["2026-07-27", "2026-07-29"])


class RenderingTests(unittest.TestCase):
    def test_zero_value_is_not_rendered_as_missing(self) -> None:
        rows = [{"zone_five_milli": 0}]
        html = report._table(rows, ["zone_five_milli"])
        self.assertIn(">0<", html)
        self.assertNotIn(">—<", html)

    def test_none_value_is_rendered_as_missing(self) -> None:
        rows = [{"recovery_score": None}]
        html = report._table(rows, ["recovery_score"])
        self.assertIn(">—<", html)

    def test_empty_rows_render_placeholder_not_empty_table(self) -> None:
        html = report._table([], ["date"])
        self.assertNotIn("<table", html)
        self.assertIn("No data", html)

    def test_html_special_characters_are_escaped(self) -> None:
        rows = [{"sport_name": "<script>alert(1)</script>"}]
        html = report._table(rows, ["sport_name"])
        self.assertNotIn("<script>", html)
        self.assertIn("&lt;script&gt;", html)

    def test_line_chart_with_no_data_shows_placeholder_not_broken_svg(self) -> None:
        html = report._line_chart([{"date": "2026-07-28", "x": None}], "x", "X", "#000")
        self.assertNotIn("<svg", html)
        self.assertIn("No X data", html)

    def test_single_point_chart_does_not_divide_by_zero(self) -> None:
        html = report._line_chart([{"date": "2026-07-28", "x": 5.0}], "x", "X", "#000")
        self.assertIn("<svg", html)


class TrimZerosTests(unittest.TestCase):
    def test_whole_number_loses_the_decimal_entirely(self) -> None:
        self.assertEqual(report._trim_zeros("62.00"), "62")
        self.assertEqual(report._trim_zeros("100.0"), "100")

    def test_real_fractional_value_keeps_only_the_meaningful_digits(self) -> None:
        self.assertEqual(report._trim_zeros("62.50"), "62.5")
        self.assertEqual(report._trim_zeros("62.53"), "62.53")

    def test_negative_values_trim_correctly(self) -> None:
        self.assertEqual(report._trim_zeros("-1.00"), "-1")
        self.assertEqual(report._trim_zeros("-1.50"), "-1.5")

    def test_rounded_formatter_trims_and_handles_missing(self) -> None:
        formatter = report._rounded_formatter("x", 2)
        self.assertEqual(formatter({"x": 62.0}), "62")
        self.assertEqual(formatter({"x": 62.5}), "62.5")
        self.assertEqual(formatter({"x": None}), "—")

    def test_stat_tile_trim_flag_applies_to_value_and_delta(self) -> None:
        trimmed = report._stat_tile("RHR", 55.0, " bpm", delta=-5.0, good_direction="down", trim=True)
        self.assertIn("55 bpm", trimmed)
        self.assertIn("-5 bpm", trimmed)
        self.assertNotIn("55.0", trimmed)

        untrimmed = report._stat_tile("RHR", 55.0, " bpm", delta=-5.0, good_direction="down")
        self.assertIn("55.0 bpm", untrimmed)

    def test_stat_tile_trim_preserves_real_decimals(self) -> None:
        html = report._stat_tile("RHR", 55.5, " bpm", trim=True)
        self.assertIn("55.5 bpm", html)

    def test_line_chart_trim_flag_applies_to_tooltip(self) -> None:
        rows = [{"date": "2026-07-28", "x": 60.0}, {"date": "2026-07-29", "x": 61.5}]
        trimmed = report._line_chart(rows, "x", "X", "#000", trim=True)
        self.assertIn("2026-07-28: 60<", trimmed)
        self.assertIn("2026-07-29: 61.5<", trimmed)

        untrimmed = report._line_chart(rows, "x", "X", "#000")
        self.assertIn("2026-07-28: 60.00", untrimmed)


class StatTileTests(unittest.TestCase):
    def test_average_ignores_missing_values(self) -> None:
        rows = [{"x": 10.0}, {"x": None}, {"x": 20.0}]
        self.assertEqual(report._average(rows, "x"), 15.0)

    def test_average_of_all_missing_is_none(self) -> None:
        rows = [{"x": None}, {"x": None}]
        self.assertIsNone(report._average(rows, "x"))

    def test_stat_tile_renders_value_with_unit(self) -> None:
        html = report._stat_tile("Average HRV", 45.23, " ms")
        self.assertIn("Average HRV", html)
        self.assertIn("45.2 ms", html)

    def test_stat_tile_renders_dash_when_no_data(self) -> None:
        html = report._stat_tile("Average HRV", None, " ms")
        self.assertIn(">—<", html)


class BuildHtmlIntegrationTests(unittest.TestCase):
    def test_full_report_contains_all_three_sections(self) -> None:
        data = {
            "recovery": [
                {
                    "created_at": "2026-07-28T07:00:00.000Z",
                    "score_state": "SCORED",
                    "score": {"recovery_score": 62.0, "resting_heart_rate": 54.0,
                              "hrv_rmssd_milli": 45.2, "skin_temp_celsius": 33.4},
                }
            ],
            "sleep": [],
            "workout": [],
        }
        html = report.build_html("default", "2026-07-27", "2026-08-03", data)
        self.assertIn("Recovery", html)
        self.assertIn("Sleep", html)
        self.assertIn("Workout", html)
        self.assertIn(">recovery_score<", html)  # table header specifically, not just JS source text
        self.assertIn("No data in this range", html)  # sleep/workout tables are empty

    def test_stat_bar_shows_todays_average(self) -> None:
        # "Today" = the report's end_date (the anchor for the default "day" view).
        # Two records on that same date should average together; a record on a
        # different date must not be pulled into "today"'s number.
        data = {
            "recovery": [
                {"created_at": "2026-08-03T00:00:00Z",
                 "score": {"resting_heart_rate": 50.0, "hrv_rmssd_milli": 40.0, "skin_temp_celsius": 33.0}},
                {"created_at": "2026-08-03T12:00:00Z",
                 "score": {"resting_heart_rate": 60.0, "hrv_rmssd_milli": 50.0, "skin_temp_celsius": 34.0}},
                {"created_at": "2026-07-20T00:00:00Z",  # a different day - must not be averaged in
                 "score": {"resting_heart_rate": 999.0, "hrv_rmssd_milli": 999.0, "skin_temp_celsius": 999.0}},
            ],
            "sleep": [],
            "workout": [],
        }
        bar = stat_bar_html(report.build_html("default", "2026-07-27", "2026-08-03", data))
        self.assertIn("55 bpm", bar)  # whole number -> no decimal, RHR is trimmed
        self.assertIn("45.0 ms", bar)
        self.assertIn("33.5", bar)
        self.assertIn("today", bar)
        self.assertNotIn("999.0", bar)

    def test_score_state_column_is_not_rendered_anywhere(self) -> None:
        data = {
            "recovery": [{"created_at": "2026-07-28T00:00:00Z", "score_state": "SCORED", "score": {}}],
            "sleep": [{"start": "2026-07-28T00:00:00Z", "score_state": "SCORED", "score": {}}],
            "workout": [{"start": "2026-07-28T00:00:00Z", "score_state": "SCORED", "score": {}}],
        }
        html = report.build_html("default", "2026-07-27", "2026-08-03", data)
        self.assertNotIn(">score_state<", html)
        self.assertNotIn(">SCORED<", html)

    def test_workout_table_omits_null_distance_and_altitude_gain(self) -> None:
        data = {
            "recovery": [],
            "sleep": [],
            "workout": [
                {
                    "start": "2026-07-28T18:00:00Z",
                    "sport_name": "weightlifting",
                    "score": {
                        "strain": 10.0,
                        "distance_meter": None,
                        "altitude_gain_meter": None,
                        "altitude_change_meter": None,
                    },
                }
            ],
        }
        html = report.build_html("default", "2026-07-27", "2026-08-03", data)
        self.assertNotIn(">distance_meter<", html)
        self.assertNotIn(">altitude_gain_meter<", html)
        self.assertIn(">altitude_change_meter<", html)


class FetchDataTests(unittest.TestCase):
    def test_previous_period_is_equal_length_and_immediately_before(self) -> None:
        # 2026-07-27..2026-08-03 is 8 days inclusive; previous period must also be
        # 8 days, ending the day before start (not hardcoded to 7 days anywhere).
        previous_start, previous_end = report._previous_period("2026-07-27", "2026-08-03")
        self.assertEqual(previous_end, "2026-07-26")
        self.assertEqual(previous_start, "2026-07-19")

    def test_makes_exactly_three_calls_not_five(self) -> None:
        # One recovery call spanning both periods, one sleep call, one workout call -
        # no `daily` (which would also pull unused cycle data), no separate
        # previous-period recovery call.
        calls = []

        def fake_run(cmd, capture_output, text):
            calls.append(cmd)
            return type("R", (), {"returncode": 0, "stdout": json.dumps({"data": []}), "stderr": ""})()

        with patch("subprocess.run", side_effect=fake_run):
            report.fetch_report_data("default", "2026-07-27", "2026-08-03")

        self.assertEqual(len(calls), 3)
        self.assertNotIn("daily", [arg for call in calls for arg in call])
        self.assertIn("recovery", calls[0])
        self.assertIn("sleep", calls[1])
        self.assertIn("workout", calls[2])

    def test_recovery_call_spans_from_previous_period_start_to_current_end(self) -> None:
        calls = []

        def fake_run(cmd, capture_output, text):
            calls.append(cmd)
            return type("R", (), {"returncode": 0, "stdout": json.dumps({"data": []}), "stderr": ""})()

        with patch("subprocess.run", side_effect=fake_run):
            report.fetch_report_data("default", "2026-07-27", "2026-08-03")

        recovery_call = calls[0]
        self.assertIn("2026-07-19T00:00:00.000Z", recovery_call)  # previous period start
        self.assertIn("2026-08-03T23:59:59.999Z", recovery_call)  # current period end

    def test_recovery_records_are_split_by_date_into_current_and_previous(self) -> None:
        combined_recovery = {
            "data": [
                {"id": "prev-1", "created_at": "2026-07-20T00:00:00Z"},
                {"id": "current-1", "created_at": "2026-07-28T00:00:00Z"},
                {"id": "current-2", "created_at": "2026-08-03T00:00:00Z"},
            ]
        }

        def fake_run(cmd, capture_output, text):
            if "recovery" in cmd:
                return type("R", (), {"returncode": 0, "stdout": json.dumps(combined_recovery), "stderr": ""})()
            return type("R", (), {"returncode": 0, "stdout": json.dumps({"data": []}), "stderr": ""})()

        with patch("subprocess.run", side_effect=fake_run):
            data, previous_recovery = report.fetch_report_data("default", "2026-07-27", "2026-08-03")

        self.assertEqual([r["id"] for r in data["recovery"]], ["current-1", "current-2"])
        self.assertEqual([r["id"] for r in previous_recovery], ["prev-1"])

    def test_sleep_and_workout_land_in_the_right_buckets(self) -> None:
        def fake_run(cmd, capture_output, text):
            if "sleep" in cmd:
                return type("R", (), {"returncode": 0, "stdout": json.dumps({"data": [{"id": "s1"}]}), "stderr": ""})()
            if "workout" in cmd:
                return type("R", (), {"returncode": 0, "stdout": json.dumps({"data": [{"id": "w1"}]}), "stderr": ""})()
            return type("R", (), {"returncode": 0, "stdout": json.dumps({"data": []}), "stderr": ""})()

        with patch("subprocess.run", side_effect=fake_run):
            data, _ = report.fetch_report_data("default", "2026-07-27", "2026-08-03")

        self.assertEqual(data["sleep"], [{"id": "s1"}])
        self.assertEqual(data["workout"], [{"id": "w1"}])

    def test_nonzero_exit_raises_report_error(self) -> None:
        def fake_run(cmd, capture_output, text):
            return type("R", (), {"returncode": 2, "stdout": "", "stderr": "not authorized"})()

        with patch("subprocess.run", side_effect=fake_run):
            with self.assertRaises(report.ReportError):
                report.fetch_report_data("default", "2026-07-27", "2026-08-03")


class PercentFormatterTests(unittest.TestCase):
    def test_rounds_to_whole_number_with_percent_sign(self) -> None:
        formatter = report._percent_formatter("x")
        self.assertEqual(formatter({"x": 88.4}), "88%")
        self.assertEqual(formatter({"x": 88.6}), "89%")

    def test_missing_value_renders_dash(self) -> None:
        formatter = report._percent_formatter("x")
        self.assertEqual(formatter({"x": None}), "—")


class ZoneBarTests(unittest.TestCase):
    def _row(self, **zones: int) -> dict:
        base = {key: None for key in report.ZONE_KEYS}
        base.update(zones)
        return base

    def test_no_zone_data_shows_placeholder(self) -> None:
        html = report._zone_bar(self._row())
        self.assertIn("No zone data", html)
        self.assertNotIn("<svg", html)

    def test_renders_one_segment_per_nonzero_zone(self) -> None:
        row = self._row(zone_zero_milli=60000, zone_two_milli=120000)
        html = report._zone_bar(row)
        self.assertIn("<svg", html)
        self.assertEqual(html.count("<rect"), 3)  # clip rect + 2 nonzero zone segments
        self.assertIn("var(--zone-0)", html)
        self.assertIn("var(--zone-2)", html)
        self.assertNotIn("var(--zone-1)", html)

    def test_tooltip_shows_minutes_not_milliseconds(self) -> None:
        row = self._row(zone_zero_milli=300000)  # 5 minutes
        html = report._zone_bar(row)
        self.assertIn("Zone 0: 5 min", html)
        self.assertNotIn("300000", html)


class SportFilterTests(unittest.TestCase):
    def test_no_workouts_renders_nothing(self) -> None:
        self.assertEqual(report._sport_filter([]), "")

    def test_lists_distinct_sports_sorted(self) -> None:
        rows = [{"sport_name": "running"}, {"sport_name": "cycling"}, {"sport_name": "running"}]
        html = report._sport_filter(rows)
        self.assertIn("All sports", html)
        running_index = html.index("running")
        cycling_index = html.index("cycling")
        self.assertLess(cycling_index, running_index)  # alphabetical
        self.assertEqual(html.count("<option"), 3)  # "All sports" + 2 distinct

    def test_includes_filter_script_targeting_workout_table(self) -> None:
        html = report._sport_filter([{"sport_name": "running"}])
        self.assertIn("workout-table", html)
        self.assertIn("<script>", html)


class StatTileDeltaTests(unittest.TestCase):
    def test_lower_is_better_and_value_decreased_shows_good(self) -> None:
        html = report._stat_tile("RHR", 50.0, " bpm", delta=-4.5, good_direction="down")
        self.assertIn(report.STATUS_GOOD, html)
        self.assertIn("improved", html)
        self.assertIn("▼", html)

    def test_lower_is_better_and_value_increased_shows_serious(self) -> None:
        html = report._stat_tile("RHR", 60.0, " bpm", delta=5.0, good_direction="down")
        self.assertIn(report.STATUS_SERIOUS, html)
        self.assertIn("worsened", html)
        self.assertIn("▲", html)

    def test_higher_is_better_and_value_increased_shows_good(self) -> None:
        html = report._stat_tile("HRV", 50.0, " ms", delta=6.0, good_direction="up")
        self.assertIn(report.STATUS_GOOD, html)
        self.assertIn("improved", html)

    def test_no_good_direction_never_colors_the_delta(self) -> None:
        # Skin temperature: no established "higher/lower is better" direction.
        html = report._stat_tile("Skin temp", 33.5, " °C", delta=0.2, good_direction=None)
        self.assertNotIn(report.STATUS_GOOD, html)
        self.assertNotIn(report.STATUS_SERIOUS, html)
        self.assertIn("vs previous period", html)

    def test_zero_delta_is_neutral_even_with_good_direction_set(self) -> None:
        html = report._stat_tile("RHR", 50.0, " bpm", delta=0.0, good_direction="down")
        self.assertNotIn(report.STATUS_GOOD, html)
        self.assertNotIn(report.STATUS_SERIOUS, html)

    def test_near_zero_delta_that_displays_as_zero_is_neutral(self) -> None:
        # -0.03 displays as "-0.0" at 1 decimal place; calling that "improved" would
        # contradict what the reader can actually see, so it must be judged neutral.
        html = report._stat_tile("RHR", 50.0, " bpm", delta=-0.03, good_direction="down")
        self.assertNotIn(report.STATUS_GOOD, html)
        self.assertNotIn(report.STATUS_SERIOUS, html)
        self.assertIn("vs previous period", html)
        self.assertIn("→", html)
        self.assertNotIn("▼", html)

    def test_no_delta_renders_no_delta_block_at_all(self) -> None:
        html = report._stat_tile("RHR", 50.0, " bpm")
        self.assertNotIn('class="stat-delta"', html)


class BuildHtmlDeltaIntegrationTests(unittest.TestCase):
    def test_report_shows_deltas_when_previous_period_available(self) -> None:
        # Current = the report's end_date ("today"); previous = the day before -
        # matching the default "day" granularity's today-vs-yesterday comparison.
        data = {
            "recovery": [
                {"created_at": "2026-08-03T00:00:00Z",
                 "score": {"resting_heart_rate": 50.0, "hrv_rmssd_milli": 50.0, "skin_temp_celsius": 33.5}},
            ],
            "sleep": [],
            "workout": [],
        }
        previous = [
            {"created_at": "2026-08-02T00:00:00Z",
             "score": {"resting_heart_rate": 55.0, "hrv_rmssd_milli": 45.0, "skin_temp_celsius": 33.3}},
        ]
        bar = stat_bar_html(report.build_html("default", "2026-07-27", "2026-08-03", data, previous))
        self.assertIn("improved", bar)  # both RHR (down) and HRV (up) moved the good way

    def test_report_has_no_delta_when_previous_period_missing(self) -> None:
        data = {
            "recovery": [
                {"created_at": "2026-08-03T00:00:00Z", "score": {"resting_heart_rate": 50.0}},
            ],
            "sleep": [],
            "workout": [],
        }
        bar = stat_bar_html(report.build_html("default", "2026-07-27", "2026-08-03", data, None))
        self.assertNotIn('class="stat-delta"', bar)
        self.assertIn("50 bpm", bar)  # today's value still shows, just no comparison


class GranularityFilterTests(unittest.TestCase):
    def _build(self) -> str:
        data = {
            "recovery": [
                {"created_at": "2026-08-03T00:00:00Z",
                 "score": {"recovery_score": 60.0, "resting_heart_rate": 50.0,
                           "hrv_rmssd_milli": 45.0, "skin_temp_celsius": 33.5}},
            ],
            "sleep": [
                {"start": "2026-08-03T23:00:00Z", "score": {"sleep_performance_percentage": 88.0}},
            ],
            "workout": [],
        }
        previous = [
            {"created_at": "2026-07-20T00:00:00Z",
             "score": {"recovery_score": 55.0, "resting_heart_rate": 55.0,
                       "hrv_rmssd_milli": 40.0, "skin_temp_celsius": 33.2}},
        ]
        return report.build_html("default", "2026-07-27", "2026-08-03", data, previous)

    def test_dropdown_has_all_four_granularities_defaulting_to_day(self) -> None:
        html = self._build()
        self.assertIn('<option value="day" selected>Day</option>', html)
        self.assertIn('<option value="week">', html)
        self.assertIn('<option value="month">', html)
        self.assertIn('<option value="year">', html)
        self.assertIn("wellnessApplyGranularity", html)

    def test_embedded_json_has_anchor_date_and_combined_recovery(self) -> None:
        html = self._build()
        match = html[html.index('id="report-data">') + len('id="report-data">'): html.index("</script>", html.index('id="report-data">'))]
        payload = json.loads(match)
        self.assertEqual(payload["anchor_date"], "2026-08-03")
        # Both the current-period and comparison-period recovery rows are present,
        # since the filter needs the full fetched history to bucket by week/month/year.
        dates = [row["date"] for row in payload["recovery"]]
        self.assertIn("2026-08-03", dates)
        self.assertIn("2026-07-20", dates)
        self.assertEqual([row["date"] for row in payload["sleep"]], ["2026-08-03"])

    def test_recovery_chart_includes_previous_period_days(self) -> None:
        # The chart draws from the combined dataset now, not just the current range -
        # a deliberate change from before this feature, documented in the README.
        html = self._build()
        self.assertIn("2026-07-20: 55", html)  # recovery_score is trimmed, "55" not "55.00"


if __name__ == "__main__":
    unittest.main()
