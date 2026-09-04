"""Mock family authorization and normalized wellness services.

The service is intentionally in-memory and mock-only.  It defines the boundary
that a hosted dashboard can call without coupling HTTP handlers to WHOOP's raw
responses or to the eventual encrypted token store.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import secrets
from threading import RLock
from typing import Callable
from urllib.parse import urlencode

from .client import WhoopClient
from .config import validate_profile
from .errors import OAuthError, QueryError


@dataclass(frozen=True)
class AuthorizationSession:
    id: str
    profile: str
    state: str
    authorization_url: str
    status: str
    expires_at: datetime

    def public_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "profile": self.profile,
            "provider": "whoop",
            "mode": "mock",
            "status": self.status,
            "authorization_url": self.authorization_url,
            "expires_at": self.expires_at.isoformat(),
        }


class FamilyWhoopService:
    """Coordinate profile-scoped mock OAuth sessions and fixture reads."""

    def __init__(
        self,
        client: WhoopClient,
        public_base_url: str,
        *,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self.client = client
        self.public_base_url = public_base_url.rstrip("/")
        self.now = now or (lambda: datetime.now(timezone.utc))
        self._sessions: dict[str, AuthorizationSession] = {}
        self._states: dict[str, str] = {}
        self._connections: dict[str, int] = {}
        self._lock = RLock()

    def start_authorization(self, profile: str) -> AuthorizationSession:
        label = validate_profile(profile)
        session_id = secrets.token_urlsafe(18)
        state = secrets.token_urlsafe(32)
        expires_at = self.now() + timedelta(minutes=10)
        authorization_url = (
            f"{self.public_base_url}/mock/whoop/consent?"
            + urlencode({"state": state})
        )
        session = AuthorizationSession(
            session_id, label, state, authorization_url, "pending", expires_at
        )
        with self._lock:
            self._sessions[session_id] = session
            self._states[state] = session_id
        return session

    def get_authorization(self, session_id: str) -> AuthorizationSession:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise OAuthError("Authorization session was not found.")
            if session.status == "pending" and self.now() >= session.expires_at:
                session = AuthorizationSession(
                    session.id,
                    session.profile,
                    session.state,
                    session.authorization_url,
                    "expired",
                    session.expires_at,
                )
                self._sessions[session_id] = session
            return session

    def session_for_state(self, state: str) -> AuthorizationSession:
        with self._lock:
            session_id = self._states.get(state)
        if session_id is None:
            raise OAuthError("Authorization state was not found.")
        session = self.get_authorization(session_id)
        if session.status != "pending":
            raise OAuthError("Authorization session is no longer pending.")
        return session

    def complete_authorization(
        self, state: str, *, code: str | None = None, denied: bool = False
    ) -> AuthorizationSession:
        session = self.session_for_state(state)
        status = "denied" if denied else "authorized"
        if not denied and not code:
            raise OAuthError("Authorization callback omitted its code.")
        with self._lock:
            if not denied:
                # The mock identity is stable for a profile. Live mode will replace
                # this with WHOOP /v2/user/profile/basic verification.
                digest = hashlib.blake2s(session.profile.encode(), digest_size=4).digest()
                user_id = int.from_bytes(digest, "big") or 1
                duplicate = next(
                    (
                        profile
                        for profile, stored_user_id in self._connections.items()
                        if stored_user_id == user_id and profile != session.profile
                    ),
                    None,
                )
                if duplicate:
                    raise OAuthError(
                        f"WHOOP user is already connected as profile {duplicate}."
                    )
                self._connections[session.profile] = user_id
            completed = AuthorizationSession(
                session.id,
                session.profile,
                session.state,
                session.authorization_url,
                status,
                session.expires_at,
            )
            self._sessions[session.id] = completed
            self._states.pop(state, None)
            return completed

    def connection_status(self, profile: str) -> dict[str, object]:
        label = validate_profile(profile)
        with self._lock:
            user_id = self._connections.get(label)
        return {
            "profile": label,
            "provider": "whoop",
            "mode": "mock",
            "connected": user_id is not None,
            "provider_user_id": user_id,
        }

    def revoke(self, profile: str) -> bool:
        label = validate_profile(profile)
        with self._lock:
            return self._connections.pop(label, None) is not None

    def normalized_wellness(
        self, profile: str, *, start: str | None, end: str | None
    ) -> dict[str, object]:
        label = validate_profile(profile)
        if not self.connection_status(label)["connected"]:
            raise OAuthError(f"WHOOP profile {label} is not connected.")
        resources: dict[str, list[object]] = {}
        for resource in ("cycles", "recovery", "sleep", "workouts"):
            payload = self.client.get(
                resource, start=start, end=end, limit=25, all_pages=True
            )
            resources[resource] = payload["records"]
        return {
            "profile": label,
            "provider": "whoop",
            "mode": "mock",
            "range": {"start": start, "end": end},
            "data": resources,
        }
