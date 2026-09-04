"""Reusable client components for WHOOP API v2."""

from .client import WhoopClient
from .family_service import AuthorizationSession, FamilyWhoopService
from .config import AppConfig, TokenSet
from .errors import (
    ApiError,
    ConfigError,
    OAuthError,
    QueryError,
    TransportError,
    WhoopError,
)
from .oauth import (
    DEFAULT_SCOPES,
    bind_verified_user,
    build_authorization_url,
    create_authorization_state,
    token_from_response,
    validate_callback,
)
from .resources import RESOURCE_SPECS, ResourceSpec
from .transport import (
    HttpResponse,
    MockTransport,
    TokenProvider,
    Transport,
    UrllibTransport,
)

__all__ = [
    "ApiError",
    "AppConfig",
    "ConfigError",
    "DEFAULT_SCOPES",
    "HttpResponse",
    "MockTransport",
    "OAuthError",
    "QueryError",
    "RESOURCE_SPECS",
    "ResourceSpec",
    "TokenProvider",
    "Transport",
    "TransportError",
    "TokenSet",
    "UrllibTransport",
    "WhoopClient",
    "AuthorizationSession",
    "FamilyWhoopService",
    "WhoopError",
    "bind_verified_user",
    "build_authorization_url",
    "create_authorization_state",
    "token_from_response",
    "validate_callback",
]
