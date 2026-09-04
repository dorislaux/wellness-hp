"""Safe error types exposed by the WHOOP client."""


class WhoopError(RuntimeError):
    """Base class for user-safe WHOOP errors."""


class QueryError(WhoopError):
    """Raised when a requested resource or query is invalid."""


class TransportError(WhoopError):
    """Raised when the configured transport cannot complete a request."""


class ApiError(WhoopError):
    """Raised when a WHOOP-like response is unsuccessful or malformed."""

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class ConfigError(WhoopError):
    """Raised when local WHOOP configuration is missing or unsafe."""


class OAuthError(WhoopError):
    """Raised when WHOOP authorization or token state is invalid."""
