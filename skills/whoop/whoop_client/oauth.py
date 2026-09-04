"""WHOOP OAuth URL, state, and token primitives without browser I/O."""

from __future__ import annotations

from dataclasses import replace
import secrets
import time
from typing import Mapping
from urllib.parse import urlencode, urlparse

from .config import AppConfig, TokenSet, validate_profile
from .errors import ConfigError, OAuthError


AUTHORIZATION_URL = "https://api.prod.whoop.com/oauth/oauth2/auth"
TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
DEFAULT_SCOPES = (
    "offline read:cycles read:recovery read:sleep read:workout read:profile"
)


def validate_redirect_uri(uri: str) -> str:
    parsed = urlparse(uri)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.fragment
    ):
        raise ConfigError("WHOOP redirect URI must be a safe HTTPS URL.")
    return uri


def create_authorization_state(profile: str) -> str:
    return validate_profile(profile) + "." + secrets.token_urlsafe(32)


def build_authorization_url(config: AppConfig, state: str) -> str:
    validate_redirect_uri(config.redirect_uri)
    if len(state) < 8:
        raise OAuthError("OAuth state must contain at least eight characters.")
    query = urlencode(
        {
            "response_type": "code",
            "client_id": config.client_id,
            "redirect_uri": config.redirect_uri,
            "scope": config.scopes,
            "state": state,
        }
    )
    return f"{AUTHORIZATION_URL}?{query}"


def validate_callback(
    callback: Mapping[str, str], expected_state: str
) -> str:
    if callback.get("state") != expected_state:
        raise OAuthError("WHOOP OAuth state mismatch.")
    if callback.get("error"):
        raise OAuthError("WHOOP authorization was denied or failed.")
    code = callback.get("code", "").strip()
    if not code:
        raise OAuthError("WHOOP callback did not include an authorization code.")
    return code


def token_from_response(
    payload: Mapping[str, object],
    *,
    now: float | None = None,
) -> TokenSet:
    access = payload.get("access_token")
    refresh = payload.get("refresh_token")
    token_type = payload.get("token_type")
    scopes = payload.get("scope")
    expires_in = payload.get("expires_in")
    if not isinstance(access, str) or not access:
        raise OAuthError("WHOOP token response omitted the access token.")
    if not isinstance(refresh, str) or not refresh:
        raise OAuthError("WHOOP token response omitted the rotating refresh token.")
    if not isinstance(token_type, str) or token_type.lower() != "bearer":
        raise OAuthError("WHOOP token response used an unsupported token type.")
    if not isinstance(scopes, str) or "offline" not in scopes.split():
        raise OAuthError("WHOOP token response did not grant offline access.")
    if not isinstance(expires_in, (int, float)) or expires_in <= 60:
        raise OAuthError("WHOOP token response has an invalid expiry.")
    current = time.time() if now is None else now
    return TokenSet(access, refresh, current + float(expires_in) - 60.0, scopes)


def bind_verified_user(tokens: TokenSet, user_id: int) -> TokenSet:
    if user_id <= 0:
        raise OAuthError("WHOOP profile returned an invalid user ID.")
    return replace(tokens, user_id=user_id)
