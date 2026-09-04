from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest

from whoop_client import MockTransport, WhoopClient
from whoop_client.errors import OAuthError
from whoop_client.family_service import FamilyWhoopService


FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


class FamilyWhoopServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.current = datetime(2026, 8, 7, tzinfo=timezone.utc)
        self.service = FamilyWhoopService(
            WhoopClient(MockTransport(FIXTURES)),
            "https://wellness.example",
            now=lambda: self.current,
        )

    def test_authorization_url_is_qr_ready_and_state_is_opaque(self) -> None:
        session = self.service.start_authorization("adult_a")
        self.assertTrue(
            session.authorization_url.startswith(
                "https://wellness.example/mock/whoop/consent?state="
            )
        )
        self.assertNotIn("adult_a", session.authorization_url)
        self.assertEqual("pending", session.status)

    def test_complete_connect_read_and_revoke(self) -> None:
        session = self.service.start_authorization("adult_a")
        completed = self.service.complete_authorization(
            session.state, code="mock-code"
        )
        self.assertEqual("authorized", completed.status)
        self.assertTrue(self.service.connection_status("adult_a")["connected"])

        payload = self.service.normalized_wellness(
            "adult_a", start=None, end=None
        )
        self.assertEqual("adult_a", payload["profile"])
        self.assertEqual(
            {"cycles", "recovery", "sleep", "workouts"},
            set(payload["data"]),
        )
        self.assertTrue(self.service.revoke("adult_a"))
        self.assertFalse(self.service.connection_status("adult_a")["connected"])

    def test_expired_session_cannot_complete(self) -> None:
        session = self.service.start_authorization("adult_a")
        self.current += timedelta(minutes=11)
        self.assertEqual("expired", self.service.get_authorization(session.id).status)
        with self.assertRaisesRegex(OAuthError, "no longer pending"):
            self.service.complete_authorization(session.state, code="mock-code")

    def test_unconnected_profile_cannot_read_data(self) -> None:
        with self.assertRaisesRegex(OAuthError, "not connected"):
            self.service.normalized_wellness("adult_a", start=None, end=None)


if __name__ == "__main__":
    unittest.main()
