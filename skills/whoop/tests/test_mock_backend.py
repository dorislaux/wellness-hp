from __future__ import annotations

import http.client
import json
from pathlib import Path
from threading import Thread
import unittest

from http.server import ThreadingHTTPServer

from whoop_client import MockTransport, WhoopClient
from whoop_client.family_service import FamilyWhoopService
from scripts.mock_backend import make_handler


FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


class MockBackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        client = WhoopClient(MockTransport(FIXTURES))
        service = FamilyWhoopService(client, "http://127.0.0.1")
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(service))
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.server.server_port

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, method: str, path: str) -> tuple[int, dict[str, object]]:
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        connection.request(method, path)
        response = connection.getresponse()
        payload = json.loads(response.read())
        connection.close()
        return response.status, payload

    def test_full_api_flow(self) -> None:
        status, started = self.request(
            "POST", "/api/v1/members/adult_a/whoop/authorizations"
        )
        self.assertEqual(201, status)

        session_id = started["id"]
        state = started["authorization_url"].split("state=", 1)[1]
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        connection.request("GET", f"/oauth/whoop/callback?state={state}&code=ok")
        response = connection.getresponse()
        self.assertEqual(200, response.status)
        response.read()
        connection.close()

        status, authorization = self.request(
            "GET",
            f"/api/v1/members/adult_a/whoop/authorizations/{session_id}",
        )
        self.assertEqual(200, status)
        self.assertEqual("authorized", authorization["status"])

        status, wellness = self.request(
            "GET", "/api/v1/members/adult_a/wellness"
        )
        self.assertEqual(200, status)
        self.assertIn("cycles", wellness["data"])

        status, revoked = self.request(
            "DELETE", "/api/v1/members/adult_a/whoop"
        )
        self.assertEqual(200, status)
        self.assertTrue(revoked["revoked"])


if __name__ == "__main__":
    unittest.main()
