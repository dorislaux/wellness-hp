#!/usr/bin/env python3
"""Run the mock WHOOP family-dashboard backend."""

from __future__ import annotations

import argparse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
from urllib.parse import parse_qs, quote, urlparse

SKILL_DIR = Path(__file__).resolve().parent.parent
if str(SKILL_DIR) not in sys.path:
    sys.path.insert(0, str(SKILL_DIR))

from whoop_client import MockTransport, WhoopClient, WhoopError
from whoop_client.family_service import FamilyWhoopService


def make_handler(service: FamilyWhoopService) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "WhoopMockBackend/0.1"

        def _json(self, status: int, payload: object) -> None:
            body = json.dumps(payload, sort_keys=True).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _html(self, status: int, body_text: str) -> None:
            body = body_text.encode()
            self.send_response(status)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _parts(self) -> tuple[list[str], dict[str, list[str]]]:
            parsed = urlparse(self.path)
            return [part for part in parsed.path.split("/") if part], parse_qs(parsed.query)

        def do_POST(self) -> None:
            parts, _ = self._parts()
            try:
                if (
                    len(parts) == 6
                    and parts[:3] == ["api", "v1", "members"]
                    and parts[4:] == ["whoop", "authorizations"]
                ):
                    session = service.start_authorization(parts[3])
                    self._json(HTTPStatus.CREATED, session.public_dict())
                    return
                self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            except WhoopError as exc:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})

        def do_GET(self) -> None:
            parts, query = self._parts()
            try:
                if parts == ["health"]:
                    self._json(HTTPStatus.OK, {"status": "ok", "mode": "mock"})
                    return
                if parts == ["mock", "whoop", "consent"]:
                    state = query.get("state", [""])[0]
                    session = service.session_for_state(state)
                    callback = f"/oauth/whoop/callback?state={quote(state)}"
                    self._html(
                        HTTPStatus.OK,
                        "<!doctype html><meta name=viewport content='width=device-width'>"
                        "<title>Mock WHOOP consent</title><h1>Mock WHOOP consent</h1>"
                        f"<p>Connect profile <strong>{session.profile}</strong>?</p>"
                        f"<p><a href='{callback}&code=mock-code'>Authorize</a></p>"
                        f"<p><a href='{callback}&error=access_denied'>Deny</a></p>",
                    )
                    return
                if parts == ["oauth", "whoop", "callback"]:
                    state = query.get("state", [""])[0]
                    denied = bool(query.get("error"))
                    code = query.get("code", [None])[0]
                    session = service.complete_authorization(
                        state, code=code, denied=denied
                    )
                    self._html(
                        HTTPStatus.OK,
                        "<!doctype html><meta name=viewport content='width=device-width'>"
                        f"<title>WHOOP {session.status}</title>"
                        f"<h1>WHOOP {session.status}</h1>"
                        "<p>You can return to the family dashboard.</p>",
                    )
                    return
                if (
                    len(parts) == 7
                    and parts[:3] == ["api", "v1", "members"]
                    and parts[4:6] == ["whoop", "authorizations"]
                ):
                    session = service.get_authorization(parts[6])
                    if session.profile != parts[3]:
                        self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                    else:
                        self._json(HTTPStatus.OK, session.public_dict())
                    return
                if (
                    len(parts) == 6
                    and parts[:3] == ["api", "v1", "members"]
                    and parts[4:] == ["whoop", "status"]
                ):
                    self._json(HTTPStatus.OK, service.connection_status(parts[3]))
                    return
                if (
                    len(parts) == 5
                    and parts[:3] == ["api", "v1", "members"]
                    and parts[4] == "wellness"
                ):
                    payload = service.normalized_wellness(
                        parts[3],
                        start=query.get("start", [None])[0],
                        end=query.get("end", [None])[0],
                    )
                    self._json(HTTPStatus.OK, payload)
                    return
                self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            except WhoopError as exc:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})

        def do_DELETE(self) -> None:
            parts, _ = self._parts()
            try:
                if (
                    len(parts) == 5
                    and parts[:3] == ["api", "v1", "members"]
                    and parts[4] == "whoop"
                ):
                    removed = service.revoke(parts[3])
                    self._json(HTTPStatus.OK, {"revoked": removed})
                    return
                self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            except WhoopError as exc:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})

        def log_message(self, format: str, *args: object) -> None:
            print(f"{self.address_string()} - {format % args}", file=sys.stderr)

    return Handler


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--public-base-url", default="http://localhost:8787")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    transport = MockTransport(SKILL_DIR / "fixtures")
    service = FamilyWhoopService(
        WhoopClient(transport), args.public_base_url
    )
    server = ThreadingHTTPServer((args.host, args.port), make_handler(service))
    print(f"Mock WHOOP backend listening at {args.public_base_url}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
