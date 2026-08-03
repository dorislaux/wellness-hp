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
        self.assertIn("recovery_score", html)
        self.assertIn("No data in this range", html)  # sleep/workout tables are empty


class FetchDataTests(unittest.TestCase):
    def test_fetch_data_calls_whoop_cli_with_expected_args(self) -> None:
        daily_payload = {"recovery": [{"id": 1}], "sleep": [{"id": 2}]}
        workout_payload = {"data": [{"id": 3}]}

        calls = []

        def fake_run(cmd, capture_output, text):
            calls.append(cmd)
            if "daily" in cmd:
                stdout = json.dumps(daily_payload)
            else:
                stdout = json.dumps(workout_payload)
            return type("R", (), {"returncode": 0, "stdout": stdout, "stderr": ""})()

        with patch("subprocess.run", side_effect=fake_run):
            result = report.fetch_data("default", "2026-07-27", "2026-08-03")

        self.assertEqual(result["recovery"], [{"id": 1}])
        self.assertEqual(result["sleep"], [{"id": 2}])
        self.assertEqual(result["workout"], [{"id": 3}])
        self.assertEqual(len(calls), 2)
        self.assertIn("daily", calls[0])
        self.assertIn("workout", calls[1])

    def test_nonzero_exit_raises_report_error(self) -> None:
        def fake_run(cmd, capture_output, text):
            return type("R", (), {"returncode": 2, "stdout": "", "stderr": "not authorized"})()

        with patch("subprocess.run", side_effect=fake_run):
            with self.assertRaises(report.ReportError):
                report.fetch_data("default", "2026-07-27", "2026-08-03")


if __name__ == "__main__":
    unittest.main()
