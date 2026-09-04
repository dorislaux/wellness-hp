from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest

SKILL_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL_DIR))

from whoop_client import ApiError, HttpResponse, MockTransport, QueryError, WhoopClient


FIXTURES = SKILL_DIR / "fixtures"


class ClientTests(unittest.TestCase):
    def test_resources_are_allowlisted(self) -> None:
        from whoop_client import RESOURCE_SPECS

        self.assertEqual(
            set(RESOURCE_SPECS), {"cycles", "recovery", "sleep", "workouts"}
        )

    def test_pagination_merges_pages(self) -> None:
        client = WhoopClient(MockTransport(FIXTURES))
        first = client.get("cycles")
        all_pages = client.get("cycles", all_pages=True)
        self.assertEqual(len(first["records"]), 2)
        self.assertEqual(first["next_token"], "mock-offset-2")
        self.assertEqual(len(all_pages["records"]), 3)
        self.assertEqual(all_pages["page_count"], 2)
        self.assertIsNone(all_pages["next_token"])

    def test_query_is_encoded_and_authorization_is_optional(self) -> None:
        transport = MockTransport(FIXTURES)
        WhoopClient(transport).get(
            "sleep",
            start="2026-08-01T00:00:00+08:00",
            end="2026-08-05T00:00:00+08:00",
        )
        _, url, headers = transport.requests[0]
        self.assertIn("%2B08%3A00", url)
        self.assertNotIn("Authorization", headers)

    def test_unknown_resource_and_invalid_query_are_rejected(self) -> None:
        client = WhoopClient(MockTransport(FIXTURES))
        with self.assertRaises(QueryError):
            client.get("arbitrary-url")
        for limit in (0, 26):
            with self.subTest(limit=limit), self.assertRaises(QueryError):
                client.get("sleep", limit=limit)
        with self.assertRaises(QueryError):
            client.get("sleep", start="2026-08-01T00:00:00")
        with self.assertRaises(QueryError):
            client.get(
                "sleep",
                start="2026-08-04T00:00:00Z",
                end="2026-08-03T00:00:00Z",
            )

    def test_error_statuses_are_typed(self) -> None:
        for status in (400, 401, 403):
            transport = MockTransport(
                FIXTURES,
                scripted_responses=[HttpResponse(status, {}, b'{}')],
            )
            with self.subTest(status=status), self.assertRaises(ApiError) as caught:
                WhoopClient(transport).get("recovery")
            self.assertEqual(caught.exception.status, status)

    def test_429_honors_retry_after_then_succeeds(self) -> None:
        success = HttpResponse(200, {}, b'{"records": []}')
        transport = MockTransport(
            FIXTURES,
            scripted_responses=[
                HttpResponse(429, {"retry-after": "3"}, b'{}'),
                success,
            ],
        )
        delays: list[float] = []
        result = WhoopClient(transport, sleep=delays.append).get("recovery")
        self.assertEqual(result["records"], [])
        self.assertEqual(delays, [3.0])
        self.assertEqual(len(transport.requests), 2)

    def test_5xx_uses_bounded_exponential_jitter(self) -> None:
        success = HttpResponse(200, {}, b'{"records": []}')
        transport = MockTransport(
            FIXTURES,
            scripted_responses=[
                HttpResponse(503, {}, b'{}'),
                HttpResponse(503, {}, b'{}'),
                success,
            ],
        )
        delays: list[float] = []
        WhoopClient(
            transport,
            sleep=delays.append,
            random=lambda: 0.25,
        ).get("sleep")
        self.assertEqual(delays, [1.25, 2.25])
        self.assertEqual(len(transport.requests), 3)

    def test_retry_budget_is_bounded(self) -> None:
        throttled = HttpResponse(429, {"Retry-After": "999"}, b'{}')
        transport = MockTransport(
            FIXTURES,
            scripted_responses=[throttled, throttled, throttled],
        )
        delays: list[float] = []
        with self.assertRaises(ApiError) as caught:
            WhoopClient(transport, sleep=delays.append).get("workouts")
        self.assertEqual(caught.exception.status, 429)
        self.assertEqual(delays, [60.0, 60.0])
        self.assertEqual(len(transport.requests), 3)

    def test_401_is_never_retried(self) -> None:
        unauthorized = HttpResponse(401, {}, b'{}')
        transport = MockTransport(
            FIXTURES,
            scripted_responses=[unauthorized, HttpResponse(200, {}, b'{"records": []}')],
        )
        delays: list[float] = []
        with self.assertRaises(ApiError):
            WhoopClient(transport, sleep=delays.append).get("recovery")
        self.assertEqual(delays, [])
        self.assertEqual(len(transport.requests), 1)

    def test_malformed_payloads_are_rejected(self) -> None:
        responses = (
            HttpResponse(200, {}, b"not-json"),
            HttpResponse(200, {}, b'{}'),
            HttpResponse(200, {}, b'{"records": [], "next_token": 3}'),
        )
        for response in responses:
            transport = MockTransport(FIXTURES, scripted_responses=[response])
            with self.subTest(body=response.body), self.assertRaises(ApiError):
                WhoopClient(transport).get("recovery")

    def test_repeated_token_and_page_limit_are_bounded(self) -> None:
        repeated = HttpResponse(
            200, {}, json.dumps({"records": [], "next_token": "same"}).encode()
        )
        transport = MockTransport(FIXTURES, scripted_responses=[repeated, repeated])
        with self.assertRaisesRegex(ApiError, "repeated"):
            WhoopClient(transport).get("cycles", all_pages=True)

        transport = MockTransport(FIXTURES, scripted_responses=[repeated])
        with self.assertRaisesRegex(ApiError, "safety limit"):
            WhoopClient(transport, max_pages=1).get("cycles", all_pages=True)


if __name__ == "__main__":
    unittest.main()
