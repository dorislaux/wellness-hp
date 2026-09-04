"""Transport contracts and a fixture-backed WHOOP transport."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
from pathlib import Path
from typing import Mapping, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .errors import TransportError
from .resources import RESOURCE_SPECS


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes


class Transport(Protocol):
    mode: str

    def request(
        self,
        method: str,
        url: str,
        headers: Mapping[str, str],
        body: bytes | None,
        timeout: float,
    ) -> HttpResponse: ...


class TokenProvider(Protocol):
    def access_token(self) -> str: ...


class _NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(
        self,
        req: Request,
        fp: object,
        code: int,
        msg: str,
        headers: Mapping[str, str],
        newurl: str,
    ) -> None:
        del req, fp, code, msg, headers, newurl
        return None


class UrllibTransport:
    """Perform bounded HTTPS requests using the Python standard library."""

    mode = "live"

    def __init__(
        self,
        *,
        opener: object | None = None,
        max_response_bytes: int = 10_000_000,
    ) -> None:
        if max_response_bytes <= 0:
            raise ValueError("max_response_bytes must be positive")
        self.opener = opener or build_opener(_NoRedirectHandler())
        self.max_response_bytes = max_response_bytes

    def _read_response(self, response: object, status: int) -> HttpResponse:
        try:
            body = response.read(self.max_response_bytes + 1)
            headers = dict(response.headers.items())
        except OSError as exc:
            raise TransportError("Could not read the WHOOP API response.") from exc
        finally:
            response.close()
        if len(body) > self.max_response_bytes:
            raise TransportError("WHOOP API response exceeded the size limit.")
        return HttpResponse(status, headers, body)

    def request(
        self,
        method: str,
        url: str,
        headers: Mapping[str, str],
        body: bytes | None,
        timeout: float,
    ) -> HttpResponse:
        parsed = urlparse(url)
        if parsed.scheme != "https" or not parsed.hostname:
            raise TransportError("Live WHOOP requests require an HTTPS URL.")
        if parsed.username or parsed.password or parsed.fragment:
            raise TransportError("Live WHOOP request URL is unsafe.")
        request_headers = {"User-Agent": "wellness-hp-whoop/0.1", **headers}
        request = Request(url, data=body, headers=request_headers, method=method)
        try:
            response = self.opener.open(request, timeout=timeout)
        except HTTPError as exc:
            return self._read_response(exc, exc.code)
        except (URLError, TimeoutError, OSError) as exc:
            raise TransportError("WHOOP API network request failed.") from exc
        return self._read_response(response, response.status)


def _parse_datetime(value: str) -> datetime:
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    return datetime.fromisoformat(normalized)


class MockTransport:
    """Serve synthetic WHOOP responses without network access."""

    mode = "mock"
    _fixture_names = {
        "cycles": ("cycles_page_1.json", "cycles_page_2.json"),
        "recovery": ("recoveries.json",),
        "sleep": ("sleeps.json",),
        "workouts": ("workouts.json",),
    }

    def __init__(
        self,
        fixture_dir: Path,
        *,
        scripted_responses: list[HttpResponse] | None = None,
    ) -> None:
        self.fixture_dir = fixture_dir
        self.scripted_responses = list(scripted_responses or [])
        self.requests: list[tuple[str, str, Mapping[str, str]]] = []

    def missing_fixtures(self) -> list[str]:
        return sorted(
            name
            for names in self._fixture_names.values()
            for name in names
            if not (self.fixture_dir / name).is_file()
        )

    def _load(self, name: str) -> dict[str, object]:
        try:
            payload = json.loads((self.fixture_dir / name).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise TransportError(f"Could not load mock fixture: {name}") from exc
        if not isinstance(payload, dict):
            raise TransportError(f"Mock fixture must contain a JSON object: {name}")
        return payload

    def _all_records(self, resource: str) -> list[dict[str, object]]:
        records: list[dict[str, object]] = []
        for name in self._fixture_names[resource]:
            page_records = self._load(name).get("records")
            if not isinstance(page_records, list) or not all(
                isinstance(record, dict) for record in page_records
            ):
                raise TransportError(f"Mock fixture has invalid records: {name}")
            records.extend(page_records)
        return records

    def _record_time(self, resource: str, record: Mapping[str, object]) -> datetime:
        if resource == "recovery":
            sleep_id = record.get("sleep_id")
            sleeps = self._all_records("sleep")
            matching = [sleep for sleep in sleeps if sleep.get("id") == sleep_id]
            if not matching:
                raise TransportError("Recovery fixture references an unknown sleep.")
            value = matching[0].get("start")
        else:
            value = record.get("start")
        if not isinstance(value, str):
            raise TransportError(f"Mock {resource} record has no valid start time.")
        return _parse_datetime(value)

    def request(
        self,
        method: str,
        url: str,
        headers: Mapping[str, str],
        body: bytes | None,
        timeout: float,
    ) -> HttpResponse:
        del body, timeout
        self.requests.append((method, url, dict(headers)))
        if self.scripted_responses:
            return self.scripted_responses.pop(0)
        if method != "GET":
            return self._json_response(405, {"error": "method_not_allowed"})

        parsed = urlparse(url)
        resource = next(
            (
                name
                for name, spec in RESOURCE_SPECS.items()
                if parsed.path in (spec.path, "/developer" + spec.path)
            ),
            None,
        )
        if resource is None:
            return self._json_response(404, {"error": "not_found"})

        query = parse_qs(parsed.query)
        try:
            limit = int(query.get("limit", ["10"])[0])
            offset = int(query.get("nextToken", ["mock-offset-0"])[0].removeprefix("mock-offset-"))
        except ValueError:
            return self._json_response(400, {"error": "invalid_query"})

        records = self._all_records(resource)
        start = query.get("start", [None])[0]
        end = query.get("end", [None])[0]
        parsed_start = _parse_datetime(start) if start else None
        parsed_end = _parse_datetime(end) if end else None
        records = [
            record
            for record in records
            if (parsed_start is None or self._record_time(resource, record) >= parsed_start)
            and (parsed_end is None or self._record_time(resource, record) < parsed_end)
        ]

        page_size = min(limit, 2)
        page = records[offset : offset + page_size]
        payload: dict[str, object] = {"records": page}
        following_offset = offset + len(page)
        if following_offset < len(records):
            payload["next_token"] = f"mock-offset-{following_offset}"
        return self._json_response(200, payload)

    @staticmethod
    def _json_response(status: int, payload: Mapping[str, object]) -> HttpResponse:
        return HttpResponse(
            status,
            {"Content-Type": "application/json"},
            json.dumps(payload).encode("utf-8"),
        )
