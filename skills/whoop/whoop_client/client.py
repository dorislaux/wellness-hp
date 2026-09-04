"""Reusable paginated client for allowlisted WHOOP resources."""

from __future__ import annotations

from datetime import datetime
import json
import random as random_module
import time
from typing import Callable, Mapping
from urllib.parse import urlencode

from .errors import ApiError, QueryError, TransportError
from .resources import RESOURCE_SPECS
from .transport import HttpResponse, TokenProvider, Transport


def _header(headers: Mapping[str, str], name: str) -> str | None:
    target = name.lower()
    return next((value for key, value in headers.items() if key.lower() == target), None)


def parse_datetime(value: str) -> datetime:
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise QueryError(f"Invalid ISO-8601 date-time: {value}") from exc
    if parsed.tzinfo is None:
        raise QueryError("Date-times must include a UTC offset or Z suffix.")
    return parsed


def validate_query(start: str | None, end: str | None, limit: int) -> None:
    if not 1 <= limit <= 25:
        raise QueryError("Limit must be between 1 and 25.")
    parsed_start = parse_datetime(start) if start else None
    parsed_end = parse_datetime(end) if end else None
    if parsed_start and parsed_end and parsed_start >= parsed_end:
        raise QueryError("Start must be earlier than end.")


class WhoopClient:
    def __init__(
        self,
        transport: Transport,
        *,
        base_url: str = "https://api.prod.whoop.com/developer",
        token_provider: TokenProvider | None = None,
        timeout: float = 30.0,
        max_pages: int = 100,
        max_retries: int = 2,
        sleep: Callable[[float], None] = time.sleep,
        random: Callable[[], float] = random_module.random,
    ) -> None:
        if timeout <= 0:
            raise ValueError("timeout must be positive")
        if max_pages <= 0:
            raise ValueError("max_pages must be positive")
        if max_retries < 0:
            raise ValueError("max_retries cannot be negative")
        self.transport = transport
        self.base_url = base_url.rstrip("/")
        self.token_provider = token_provider
        self.timeout = timeout
        self.max_pages = max_pages
        self.max_retries = max_retries
        self.sleep = sleep
        self.random = random

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.token_provider is not None:
            token = self.token_provider.access_token()
            if not token:
                raise TransportError("Token provider returned an empty access token.")
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def _request_with_retries(self, url: str) -> HttpResponse:
        attempt = 0
        while True:
            try:
                response = self.transport.request(
                    "GET", url, self._headers(), None, self.timeout
                )
            except OSError as exc:
                raise TransportError("WHOOP transport request failed.") from exc

            delay: float | None = None
            if response.status == 429 and attempt < self.max_retries:
                retry_after = _header(response.headers, "Retry-After")
                try:
                    delay = min(60.0, max(0.0, float(retry_after or "")))
                except ValueError:
                    delay = float(2**attempt)
            elif response.status in {500, 502, 503, 504} and attempt < self.max_retries:
                delay = min(8.0, float(2**attempt) + self.random())
            if delay is None:
                return response
            self.sleep(delay)
            attempt += 1

    def _page(self, path: str, query: Mapping[str, object]) -> dict[str, object]:
        url = f"{self.base_url}{path}"
        if query:
            url += "?" + urlencode(query)
        response = self._request_with_retries(url)
        if not 200 <= response.status < 300:
            raise ApiError(
                f"WHOOP API returned HTTP {response.status}.", status=response.status
            )
        try:
            payload = json.loads(response.body)
        except (TypeError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ApiError("WHOOP API returned malformed JSON.") from exc
        if not isinstance(payload, dict):
            raise ApiError("WHOOP API response must be a JSON object.")
        records = payload.get("records")
        if not isinstance(records, list):
            raise ApiError("WHOOP API response has no records list.")
        token = payload.get("next_token")
        if token is not None and not isinstance(token, str):
            raise ApiError("WHOOP API response has an invalid next_token.")
        return payload

    def get(
        self,
        resource: str,
        *,
        start: str | None = None,
        end: str | None = None,
        limit: int = 10,
        all_pages: bool = False,
    ) -> dict[str, object]:
        spec = RESOURCE_SPECS.get(resource)
        if spec is None:
            raise QueryError(f"Unknown WHOOP resource: {resource}")
        validate_query(start, end, limit)
        query: dict[str, object] = {"limit": limit}
        if start:
            query["start"] = start
        if end:
            query["end"] = end

        records: list[object] = []
        seen_tokens: set[str] = set()
        page_count = 0
        next_token: str | None = None
        while True:
            payload = self._page(spec.path, query)
            records.extend(payload["records"])
            page_count += 1
            next_token = payload.get("next_token")
            if not all_pages or not next_token:
                break
            if next_token in seen_tokens:
                raise ApiError("WHOOP API repeated a pagination token.")
            if page_count >= self.max_pages:
                raise ApiError(
                    f"WHOOP API exceeded the {self.max_pages}-page safety limit."
                )
            seen_tokens.add(next_token)
            query["nextToken"] = next_token

        return {
            "mode": self.transport.mode,
            "resource": resource,
            "query": {"start": start, "end": end, "limit": limit},
            "records": records,
            "next_token": next_token,
            "page_count": page_count,
        }
