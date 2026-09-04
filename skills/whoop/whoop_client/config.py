"""Private, profile-isolated WHOOP configuration storage."""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import re
import shlex
import tempfile
from typing import Mapping
from urllib.parse import urlparse

from .errors import ConfigError


PROFILE_RE = re.compile(r"[a-z0-9][a-z0-9_-]{0,31}\Z")
KEY_RE = re.compile(r"WHOOP_[A-Z0-9_]+\Z")
APP_KEYS = (
    "WHOOP_CLIENT_ID",
    "WHOOP_CLIENT_SECRET",
    "WHOOP_REDIRECT_URI",
    "WHOOP_SCOPES",
)
TOKEN_KEYS = (
    "WHOOP_PROFILE",
    "WHOOP_USER_ID",
    "WHOOP_ACCESS_TOKEN",
    "WHOOP_REFRESH_TOKEN",
    "WHOOP_TOKEN_EXPIRES_AT",
    "WHOOP_GRANTED_SCOPES",
)


@dataclass(frozen=True)
class AppConfig:
    client_id: str
    client_secret: str
    redirect_uri: str
    scopes: str


@dataclass(frozen=True)
class TokenSet:
    access_token: str
    refresh_token: str
    expires_at: float
    granted_scopes: str
    user_id: int | None = None


def default_config_dir() -> Path:
    return Path.home() / ".config" / "whoop"


def validate_profile(profile: str) -> str:
    if not PROFILE_RE.fullmatch(profile):
        raise ConfigError(
            "Profile must use 1-32 lowercase letters, digits, hyphens, or underscores."
        )
    return profile


def _secure_directory(path: Path) -> None:
    try:
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(path, 0o700)
    except OSError as exc:
        raise ConfigError(f"Could not secure configuration directory: {path}") from exc


def parse_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise ConfigError(f"Could not read configuration file: {path}") from exc
    values: dict[str, str] = {}
    for line_number, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        try:
            parts = shlex.split(stripped, comments=True, posix=True)
        except ValueError as exc:
            raise ConfigError(
                f"Invalid quoting in {path} at line {line_number}."
            ) from exc
        if len(parts) != 1 or "=" not in parts[0]:
            raise ConfigError(f"Invalid entry in {path} at line {line_number}.")
        key, value = parts[0].split("=", 1)
        if not KEY_RE.fullmatch(key) or key in values:
            raise ConfigError(f"Invalid or duplicate key in {path} at line {line_number}.")
        values[key] = value
    return values


def atomic_write_env(path: Path, values: Mapping[str, str]) -> None:
    for key, value in values.items():
        if not KEY_RE.fullmatch(key):
            raise ConfigError(f"Invalid configuration key: {key}")
        if "\n" in value or "\r" in value:
            raise ConfigError(f"Configuration value for {key} contains a newline.")
    _secure_directory(path.parent)
    temporary: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=path.parent,
            prefix=f".{path.name}.",
            delete=False,
        ) as handle:
            temporary = handle.name
            os.fchmod(handle.fileno(), 0o600)
            for key, value in values.items():
                handle.write(f"{key}={shlex.quote(value)}\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        temporary = None
    except OSError as exc:
        raise ConfigError(f"Could not write configuration file: {path}") from exc
    finally:
        if temporary:
            try:
                Path(temporary).unlink()
            except FileNotFoundError:
                pass


def write_app_config(config_dir: Path, config: AppConfig) -> None:
    parsed = urlparse(config.redirect_uri)
    if (
        not config.client_id
        or not config.client_secret
        or parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.fragment
    ):
        raise ConfigError("WHOOP application configuration is incomplete or unsafe.")
    scopes = set(config.scopes.split())
    if not {"offline", "read:profile"}.issubset(scopes):
        raise ConfigError("WHOOP family authorization requires offline and read:profile scopes.")
    atomic_write_env(
        config_dir / "app.env",
        dict(
            zip(
                APP_KEYS,
                (
                    config.client_id,
                    config.client_secret,
                    config.redirect_uri,
                    config.scopes,
                ),
            )
        ),
    )


def load_app_config(config_dir: Path) -> AppConfig:
    values = parse_env_file(config_dir / "app.env")
    missing = [key for key in APP_KEYS if not values.get(key)]
    if missing:
        raise ConfigError("WHOOP application configuration is incomplete.")
    return AppConfig(*(values[key] for key in APP_KEYS))


def profile_path(config_dir: Path, profile: str) -> Path:
    return config_dir / "profiles" / f"{validate_profile(profile)}.env"


def _find_profile_for_user(config_dir: Path, user_id: int) -> str | None:
    directory = config_dir / "profiles"
    if not directory.exists():
        return None
    for path in directory.glob("*.env"):
        values = parse_env_file(path)
        if values.get("WHOOP_USER_ID") == str(user_id):
            return path.stem
    return None


def write_profile_tokens(config_dir: Path, profile: str, tokens: TokenSet) -> None:
    label = validate_profile(profile)
    if (
        not tokens.access_token
        or not tokens.refresh_token
        or tokens.expires_at <= 0
        or not tokens.granted_scopes
    ):
        raise ConfigError("WHOOP token set is incomplete.")
    if tokens.user_id is None or tokens.user_id <= 0:
        raise ConfigError("Verified WHOOP user ID is required before saving tokens.")
    existing = _find_profile_for_user(config_dir, tokens.user_id)
    if existing is not None and existing != label:
        raise ConfigError(
            f"WHOOP user is already authorized as profile {existing}; tokens were not saved."
        )
    values = {
        "WHOOP_PROFILE": label,
        "WHOOP_USER_ID": str(tokens.user_id),
        "WHOOP_ACCESS_TOKEN": tokens.access_token,
        "WHOOP_REFRESH_TOKEN": tokens.refresh_token,
        "WHOOP_TOKEN_EXPIRES_AT": repr(tokens.expires_at),
        "WHOOP_GRANTED_SCOPES": tokens.granted_scopes,
    }
    atomic_write_env(profile_path(config_dir, label), values)


def load_profile_tokens(config_dir: Path, profile: str) -> TokenSet:
    label = validate_profile(profile)
    values = parse_env_file(profile_path(config_dir, label))
    missing = [key for key in TOKEN_KEYS if not values.get(key)]
    if missing or values.get("WHOOP_PROFILE") != label:
        raise ConfigError(f"WHOOP profile {label} is incomplete or mismatched.")
    try:
        user_id = int(values["WHOOP_USER_ID"])
        expires_at = float(values["WHOOP_TOKEN_EXPIRES_AT"])
    except ValueError as exc:
        raise ConfigError(f"WHOOP profile {label} has invalid metadata.") from exc
    return TokenSet(
        values["WHOOP_ACCESS_TOKEN"],
        values["WHOOP_REFRESH_TOKEN"],
        expires_at,
        values["WHOOP_GRANTED_SCOPES"],
        user_id,
    )
