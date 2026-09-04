from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import unittest

SKILL_DIR = Path(__file__).resolve().parent.parent
SCRIPT = SKILL_DIR / "scripts" / "whoop.py"


class CliTests(unittest.TestCase):
    def run_cli(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            check=check,
            capture_output=True,
            text=True,
        )

    def test_resources_and_status_contracts_are_preserved(self) -> None:
        resources = json.loads(self.run_cli("resources").stdout)
        status = json.loads(self.run_cli("status", "--mock").stdout)
        self.assertIn("recovery", resources["resources"])
        self.assertTrue(status["ready"])
        self.assertFalse(status["live_access"])

    def test_get_outputs_mock_envelope(self) -> None:
        result = json.loads(
            self.run_cli("get", "cycles", "--mock", "--all-pages").stdout
        )
        self.assertEqual(result["mode"], "mock")
        self.assertEqual(result["page_count"], 2)
        self.assertEqual(len(result["records"]), 3)

    def test_unknown_resource_fails_safely(self) -> None:
        result = self.run_cli("get", "secret-url", "--mock", check=False)
        self.assertEqual(result.returncode, 2)
        self.assertIn("Unknown WHOOP resource", result.stderr)


if __name__ == "__main__":
    unittest.main()
