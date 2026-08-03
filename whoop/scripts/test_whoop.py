from __future__ import annotations

from dataclasses import dataclass, replace
from http.server import BaseHTTPRequestHandler, HTTPServer
import importlib.util
import io
import json
from pathlib import Path
import stat
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

SCRIPT_PATH = Path(__file__).with_name("whoop.py")
SPEC = importlib.util.spec_from_file_location("whoop_cli", SCRIPT_PATH)
assert SPEC and SPEC.loader
whoop = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = whoop
SPEC.loader.exec_module(whoop)


class ScaffoldTests(unittest.TestCase):
    def test_main_is_callable(self) -> None:
        self.assertTrue(callable(whoop.main))


class ConfigurationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.config_dir = Path(self.tempdir.name) / "whoop"

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def test_environment_overrides_app_file_and_default_is_default(self) -> None:
        whoop.write_app_config(
            self.config_dir,
            {
                "WHOOP_CLIENT_ID": "file-id",
                "WHOOP_CLIENT_SECRET": "file-secret",
                "WHOOP_REDIRECT_URI": "http://localhost:8911/callback",
                "WHOOP_SCOPES": whoop.DEFAULT_SCOPES,
                "WHOOP_DEFAULT_PROFILE": "default",
            },
        )
        config = whoop.load_app_config(
            self.config_dir,
            {"WHOOP_CLIENT_ID": "env-id"},
        )
        self.assertEqual(config.client_id, "env-id")
        self.assertEqual(config.client_secret, "file-secret")
        self.assertEqual(config.default_profile, "default")

    def test_private_files_and_directories_have_exact_modes(self) -> None:
        whoop.write_app_config(self.config_dir, whoop.example_app_values())
        whoop.write_profile_tokens(
            self.config_dir,
            "default",
            whoop.TokenSet("access", "refresh", 1234.0, "read:sleep read:recovery"),
        )
        app_mode = stat.S_IMODE((self.config_dir / "app.env").stat().st_mode)
        token_mode = stat.S_IMODE(
            (self.config_dir / "profiles" / "default.env").stat().st_mode
        )
        self.assertEqual(app_mode, 0o600)
        self.assertEqual(token_mode, 0o600)
        self.assertEqual(stat.S_IMODE(self.config_dir.stat().st_mode), 0o700)

    def test_profile_labels_are_restricted(self) -> None:
        for label in ("../secondary", "Default", "secondary/name", "", "."):
            with self.subTest(label=label), self.assertRaises(whoop.ConfigError):
                whoop.validate_profile(label)

    def test_profile_token_files_are_isolated(self) -> None:
        whoop.write_profile_tokens(
            self.config_dir,
            "default",
            whoop.TokenSet("w-access", "w-refresh", 1234.0, "read:sleep"),
        )
        whoop.write_profile_tokens(
            self.config_dir,
            "secondary",
            whoop.TokenSet("x-access", "x-refresh", 5678.0, "read:sleep"),
        )
        self.assertEqual(
            whoop.load_profile_tokens(self.config_dir, "default", {}).access_token,
            "w-access",
        )
        self.assertEqual(
            whoop.load_profile_tokens(self.config_dir, "secondary", {}).access_token,
            "x-access",
        )

    def test_process_token_override_is_never_marked_persistable(self) -> None:
        whoop.write_profile_tokens(
            self.config_dir,
            "default",
            whoop.TokenSet("file-access", "file-refresh", 1234.0, "read:sleep"),
        )
        tokens = whoop.load_profile_tokens(
            self.config_dir,
            "default",
            {
                "WHOOP_ACCESS_TOKEN": "process-access",
                "WHOOP_REFRESH_TOKEN": "process-refresh",
                "WHOOP_TOKEN_EXPIRES_AT": "9999.0",
            },
        )
        self.assertFalse(tokens.persistable)
        self.assertEqual(tokens.access_token, "process-access")


class LoopbackValidationTests(unittest.TestCase):
    def test_rejects_non_loopback_host(self) -> None:
        with self.assertRaises(whoop.ConfigError):
            whoop.validate_loopback_redirect("http://example.com:8911/callback")

    def test_rejects_missing_port(self) -> None:
        with self.assertRaises(whoop.ConfigError):
            whoop.validate_loopback_redirect("http://localhost/callback")

    def test_accepts_default_redirect(self) -> None:
        binding = whoop.validate_loopback_redirect(whoop.DEFAULT_REDIRECT_URI)
        self.assertEqual(binding.port, 8911)
        self.assertEqual(binding.path, "/callback")


class CallbackValidationTests(unittest.TestCase):
    def test_state_mismatch_is_rejected(self) -> None:
        with self.assertRaises(whoop.OAuthError):
            whoop.validate_callback({"code": "abc", "state": "wrong"}, "expected")

    def test_denied_authorization_is_rejected(self) -> None:
        with self.assertRaises(whoop.OAuthError):
            whoop.validate_callback({"error": "access_denied"}, "expected")

    def test_matching_state_returns_code(self) -> None:
        code = whoop.validate_callback({"code": "abc", "state": "s"}, "s")
        self.assertEqual(code, "abc")


class TokenExchangeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = whoop.AppConfig("client-id", "client-secret")

    def _transport_returning(self, status: int, payload: dict) -> whoop.Transport:
        def transport(method, url, headers, body, timeout):
            return whoop.HttpResponse(
                status, {"Content-Type": "application/json"}, json.dumps(payload).encode()
            )

        return transport

    def test_exchange_code_builds_token_set(self) -> None:
        transport = self._transport_returning(
            200,
            {
                "access_token": "a",
                "refresh_token": "r",
                "expires_in": 3600,
                "scope": "read:sleep read:recovery",
            },
        )
        tokens = whoop.exchange_code(self.config, "auth-code", transport, now=1000.0)
        self.assertEqual(tokens.access_token, "a")
        self.assertEqual(tokens.refresh_token, "r")
        self.assertEqual(tokens.expires_at, 1000.0 + 3600 - 60.0)

    def test_refresh_token_rotation_replaces_refresh_token(self) -> None:
        old_tokens = whoop.TokenSet("old-access", "old-refresh", 500.0, "read:sleep")
        transport = self._transport_returning(
            200,
            {
                "access_token": "new-access",
                "refresh_token": "new-refresh",
                "expires_in": 3600,
                "scope": "read:sleep",
            },
        )
        rotated = whoop.refresh_token(self.config, old_tokens, transport, now=1000.0)
        # WHOOP invalidates the prior refresh token on every use; the CLI must
        # always adopt whatever new refresh token comes back, never reuse the old one.
        self.assertEqual(rotated.refresh_token, "new-refresh")
        self.assertNotEqual(rotated.refresh_token, old_tokens.refresh_token)

    def test_failed_exchange_redacts_secret(self) -> None:
        transport = self._transport_returning(400, {"error": "invalid_grant"})
        with self.assertRaises(whoop.OAuthError) as ctx:
            whoop.exchange_code(self.config, "auth-code", transport, now=1000.0)
        self.assertNotIn("client-secret", str(ctx.exception))

    def test_non_json_error_body_surfaces_raw_text(self) -> None:
        def transport(method, url, headers, body, timeout):
            return whoop.HttpResponse(403, {}, b"Method Not Allowed")

        with self.assertRaises(whoop.OAuthError) as ctx:
            whoop.exchange_code(self.config, "auth-code", transport, now=1000.0)
        message = str(ctx.exception)
        self.assertIn("403", message)
        self.assertIn("Method Not Allowed", message)


class QueryValidationTests(unittest.TestCase):
    def test_unknown_resource_is_rejected(self) -> None:
        with self.assertRaises(whoop.QueryError):
            whoop.validate_query("not_a_resource", {})

    def test_unsupported_parameter_for_resource(self) -> None:
        with self.assertRaises(whoop.QueryError):
            whoop.validate_query("profile_basic", {"start_datetime": "2026-01-01T00:00:00Z"})

    def test_invalid_datetime_is_rejected(self) -> None:
        with self.assertRaises(whoop.QueryError):
            whoop.validate_query("sleep", {"start_datetime": "not-a-date"})

    def test_start_after_end_is_rejected(self) -> None:
        with self.assertRaises(whoop.QueryError):
            whoop.validate_query(
                "cycle",
                {
                    "start_datetime": "2026-01-02T00:00:00Z",
                    "end_datetime": "2026-01-01T00:00:00Z",
                },
            )

    def test_valid_range_is_normalized(self) -> None:
        normalized = whoop.validate_query(
            "recovery",
            {
                "start_datetime": "2026-01-01T00:00:00Z",
                "end_datetime": "2026-01-02T00:00:00Z",
            },
        )
        self.assertEqual(normalized["start_datetime"], "2026-01-01T00:00:00Z")


class FakeTransport:
    def __init__(self, responses: list[whoop.HttpResponse]) -> None:
        self.responses = list(responses)
        self.calls: list[str] = []

    def __call__(self, method, url, headers, body, timeout) -> whoop.HttpResponse:
        self.calls.append(url)
        return self.responses.pop(0)


def _json_response(status: int, payload: dict) -> whoop.HttpResponse:
    return whoop.HttpResponse(status, {}, json.dumps(payload).encode())


class ClientPaginationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.config_dir = Path(self.tempdir.name) / "whoop"
        self.config = whoop.AppConfig("client-id", "client-secret")
        self.tokens = whoop.TokenSet("access", "refresh", 99999999999.0, "read:sleep")

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def _client(self, transport: FakeTransport) -> whoop.WhoopClient:
        return whoop.WhoopClient(
            self.config,
            "default",
            self.tokens,
            self.config_dir,
            {},
            transport=transport,
            sleep=lambda _seconds: None,
            random=lambda: 0.0,
            now=lambda: 0.0,
        )

    def test_single_page_collection_uses_records_key(self) -> None:
        transport = FakeTransport(
            [_json_response(200, {"records": [{"id": 1}], "next_token": None})]
        )
        client = self._client(transport)
        result = client.get("sleep", {}, all_pages=True)
        self.assertEqual(result["data"], [{"id": 1}])
        self.assertEqual(result["page_count"], 1)

    def test_pagination_uses_nextToken_request_param(self) -> None:
        transport = FakeTransport(
            [
                _json_response(200, {"records": [{"id": 1}], "next_token": "tok-1"}),
                _json_response(200, {"records": [{"id": 2}], "next_token": None}),
            ]
        )
        client = self._client(transport)
        result = client.get("cycle", {}, all_pages=True)
        self.assertEqual(result["data"], [{"id": 1}, {"id": 2}])
        self.assertEqual(result["page_count"], 2)
        self.assertIn("nextToken=tok-1", transport.calls[1])

    def test_non_collection_resource_returns_object_directly(self) -> None:
        transport = FakeTransport([_json_response(200, {"height_meter": 1.8})])
        client = self._client(transport)
        result = client.get("profile_basic", {}, all_pages=True)
        self.assertEqual(result["data"], {"height_meter": 1.8})
        self.assertEqual(result["page_count"], 1)

    def test_repeated_pagination_token_raises(self) -> None:
        transport = FakeTransport(
            [
                _json_response(200, {"records": [], "next_token": "loop"}),
                _json_response(200, {"records": [], "next_token": "loop"}),
            ]
        )
        client = self._client(transport)
        with self.assertRaises(whoop.ApiError):
            client.get("workout", {}, all_pages=True)

    def test_retries_on_429_then_succeeds(self) -> None:
        transport = FakeTransport(
            [
                whoop.HttpResponse(429, {"Retry-After": "0"}, b"{}"),
                _json_response(200, {"records": [], "next_token": None}),
            ]
        )
        client = self._client(transport)
        result = client.get("recovery", {}, all_pages=False)
        self.assertEqual(result["data"], [])
        self.assertEqual(len(transport.calls), 2)

    def test_401_triggers_rotation_and_retry(self) -> None:
        transport = FakeTransport(
            [
                whoop.HttpResponse(401, {}, b"{}"),
                _json_response(
                    200,
                    {
                        "access_token": "new-access",
                        "refresh_token": "new-refresh",
                        "expires_in": 3600,
                        "scope": "read:sleep",
                    },
                ),
                _json_response(200, {"records": [{"id": 1}], "next_token": None}),
            ]
        )
        client = self._client(transport)
        whoop.write_app_config(self.config_dir, whoop._app_config_values(self.config))
        result = client.get("sleep", {}, all_pages=False)
        self.assertEqual(result["data"], [{"id": 1}])
        self.assertEqual(client.tokens.access_token, "new-access")
        persisted = whoop.load_profile_tokens(self.config_dir, "default", {})
        self.assertEqual(persisted.refresh_token, "new-refresh")


class _EchoHandler(BaseHTTPRequestHandler):
    def _handle(self) -> None:
        length = int(self.headers.get("Content-Length", 0))
        received_body = self.rfile.read(length) if length else b""
        if self.path == "/error":
            self.send_response(403)
            payload = b"blocked"
        else:
            payload = json.dumps(
                {
                    "method": self.command,
                    "path": self.path,
                    "received_header": self.headers.get("X-Test-Header", ""),
                    "body": received_body.decode("utf-8"),
                }
            ).encode()
            self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        self._handle()

    def do_POST(self) -> None:
        self._handle()

    def log_message(self, format: str, *args: object) -> None:
        return


class CurlTransportTests(unittest.TestCase):
    """Exercises curl_transport for real, against a local server, rather than mocking
    subprocess — the whole point of this transport is a real curl binary's real TLS/
    request behavior, so a mock would validate nothing about the actual fix."""

    def setUp(self) -> None:
        self.server = HTTPServer(("127.0.0.1", 0), _EchoHandler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()

    def test_get_round_trip(self) -> None:
        response = whoop.curl_transport(
            "GET", f"http://127.0.0.1:{self.port}/some/path", {}, None, 5.0
        )
        self.assertEqual(response.status, 200)
        self.assertEqual(response.headers.get("Content-Type"), "application/json")
        payload = json.loads(response.body)
        self.assertEqual(payload["method"], "GET")
        self.assertEqual(payload["path"], "/some/path")

    def test_post_sends_headers_and_body(self) -> None:
        response = whoop.curl_transport(
            "POST",
            f"http://127.0.0.1:{self.port}/token",
            {"X-Test-Header": "hello"},
            b"grant_type=refresh_token",
            5.0,
        )
        payload = json.loads(response.body)
        self.assertEqual(payload["method"], "POST")
        self.assertEqual(payload["received_header"], "hello")
        self.assertEqual(payload["body"], "grant_type=refresh_token")

    def test_non_2xx_status_and_body_are_both_returned(self) -> None:
        response = whoop.curl_transport(
            "GET", f"http://127.0.0.1:{self.port}/error", {}, None, 5.0
        )
        self.assertEqual(response.status, 403)
        self.assertEqual(response.body, b"blocked")


class CliTests(unittest.TestCase):
    def test_resources_command_lists_resources(self) -> None:
        buffer = io.StringIO()
        with patch("sys.stdout", buffer):
            exit_code = whoop.main(["resources"])
        self.assertEqual(exit_code, 0)
        payload = json.loads(buffer.getvalue())
        self.assertIn("sleep", payload["resources"])
        self.assertIn("cycle", payload["resources"])
        self.assertIn("profile_basic", payload["resources"])

    def test_get_rejects_unsupported_resource_before_touching_network(self) -> None:
        buffer = io.StringIO()
        with patch("sys.stderr", buffer):
            exit_code = whoop.main(["get", "not_a_resource"])
        self.assertEqual(exit_code, 2)


if __name__ == "__main__":
    unittest.main()
