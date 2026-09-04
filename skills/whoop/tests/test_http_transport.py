from __future__ import annotations

from email.message import Message
from io import BytesIO
import json
from pathlib import Path
import sys
import unittest
from urllib.error import HTTPError, URLError

SKILL_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL_DIR))

from whoop_client import TransportError, UrllibTransport, WhoopClient


class FakeResponse:
    def __init__(
        self,
        body: bytes,
        *,
        status: int = 200,
        headers: dict[str, str] | None = None,
    ) -> None:
        self._body = BytesIO(body)
        self.status = status
        self.headers = headers or {"Content-Type": "application/json"}
        self.closed = False

    def read(self, size: int = -1) -> bytes:
        return self._body.read(size)

    def close(self) -> None:
        self.closed = True


class FakeOpener:
    def __init__(self, result: object) -> None:
        self.result = result
        self.calls: list[tuple[object, float]] = []

    def open(self, request: object, *, timeout: float) -> object:
        self.calls.append((request, timeout))
        if isinstance(self.result, BaseException):
            raise self.result
        return self.result


class StaticTokenProvider:
    def access_token(self) -> str:
        return "test-access-token"


class HttpTransportTests(unittest.TestCase):
    def test_successful_request_preserves_method_headers_body_and_timeout(self) -> None:
        response = FakeResponse(b'{"records": []}', headers={"X-Test": "yes"})
        opener = FakeOpener(response)
        transport = UrllibTransport(opener=opener)

        result = transport.request(
            "POST",
            "https://api.prod.whoop.com/developer/v2/example",
            {"Authorization": "Bearer test"},
            b"payload",
            12.5,
        )

        request, timeout = opener.calls[0]
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.data, b"payload")
        self.assertEqual(request.get_header("Authorization"), "Bearer test")
        self.assertEqual(timeout, 12.5)
        self.assertEqual(result.status, 200)
        self.assertEqual(result.headers["X-Test"], "yes")
        self.assertTrue(response.closed)

    def test_http_error_is_returned_for_client_classification(self) -> None:
        headers = Message()
        headers["Retry-After"] = "3"
        error = HTTPError(
            "https://api.prod.whoop.com/developer/v2/recovery",
            429,
            "Too Many Requests",
            headers,
            BytesIO(b'{"error": "rate_limited"}'),
        )
        result = UrllibTransport(opener=FakeOpener(error)).request(
            "GET",
            error.url,
            {},
            None,
            30,
        )
        self.assertEqual(result.status, 429)
        self.assertEqual(result.headers["Retry-After"], "3")

    def test_network_errors_are_safe_transport_errors(self) -> None:
        transport = UrllibTransport(opener=FakeOpener(URLError("private detail")))
        with self.assertRaisesRegex(TransportError, "network request failed"):
            transport.request(
                "GET",
                "https://api.prod.whoop.com/developer/v2/recovery",
                {},
                None,
                30,
            )

    def test_unsafe_urls_are_rejected_before_opening(self) -> None:
        opener = FakeOpener(FakeResponse(b"{}"))
        transport = UrllibTransport(opener=opener)
        for url in (
            "http://api.prod.whoop.com/developer/v2/recovery",
            "https://user:secret@api.prod.whoop.com/developer/v2/recovery",
            "https://api.prod.whoop.com/developer/v2/recovery#fragment",
        ):
            with self.subTest(url=url), self.assertRaises(TransportError):
                transport.request("GET", url, {}, None, 30)
        self.assertEqual(opener.calls, [])

    def test_response_size_is_bounded(self) -> None:
        response = FakeResponse(b"12345")
        transport = UrllibTransport(opener=FakeOpener(response), max_response_bytes=4)
        with self.assertRaisesRegex(TransportError, "size limit"):
            transport.request(
                "GET",
                "https://api.prod.whoop.com/developer/v2/recovery",
                {},
                None,
                30,
            )
        self.assertTrue(response.closed)

    def test_client_adds_token_without_exposing_live_mode_in_cli(self) -> None:
        payload = json.dumps({"records": []}).encode()
        opener = FakeOpener(FakeResponse(payload))
        client = WhoopClient(
            UrllibTransport(opener=opener), token_provider=StaticTokenProvider()
        )
        result = client.get("recovery")
        request, _ = opener.calls[0]
        self.assertEqual(
            request.get_header("Authorization"), "Bearer test-access-token"
        )
        self.assertEqual(result["mode"], "live")


if __name__ == "__main__":
    unittest.main()
