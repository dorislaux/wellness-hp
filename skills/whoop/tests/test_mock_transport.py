from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest

SKILL_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL_DIR))

from whoop_client import MockTransport, TransportError, WhoopClient


FIXTURES = SKILL_DIR / "fixtures"


class FixtureTests(unittest.TestCase):
    def test_every_fixture_is_valid_json(self) -> None:
        for path in sorted(FIXTURES.glob("*.json")):
            with self.subTest(path=path.name):
                self.assertIsInstance(json.loads(path.read_text()), dict)

    def test_pending_cycle_omits_end_and_score(self) -> None:
        payload = json.loads((FIXTURES / "cycles_page_1.json").read_text())
        current = payload["records"][0]
        self.assertEqual(current["score_state"], "PENDING_SCORE")
        self.assertNotIn("end", current)
        self.assertNotIn("score", current)

    def test_transport_filters_recovery_by_related_sleep(self) -> None:
        result = WhoopClient(MockTransport(FIXTURES)).get(
            "recovery",
            start="2026-08-03T22:00:00Z",
            end="2026-08-04T23:00:00Z",
            all_pages=True,
        )
        self.assertEqual(len(result["records"]), 1)
        self.assertEqual(result["records"][0]["cycle_id"], 700002)

    def test_missing_fixtures_are_reported(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            missing = MockTransport(Path(directory)).missing_fixtures()
        self.assertIn("recoveries.json", missing)

    def test_invalid_fixture_becomes_transport_error(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "recoveries.json").write_text("not-json")
            transport = MockTransport(root)
            with self.assertRaises(TransportError):
                transport.request(
                    "GET",
                    "https://api.prod.whoop.com/developer/v2/recovery",
                    {},
                    None,
                    30,
                )


if __name__ == "__main__":
    unittest.main()
