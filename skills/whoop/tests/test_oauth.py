from __future__ import annotations

from pathlib import Path
import stat
import sys
import tempfile
import unittest
from urllib.parse import parse_qs, urlparse

SKILL_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL_DIR))

from whoop_client import (
    AppConfig,
    ConfigError,
    DEFAULT_SCOPES,
    OAuthError,
    TokenSet,
    bind_verified_user,
    build_authorization_url,
    create_authorization_state,
    token_from_response,
    validate_callback,
)
from whoop_client.config import (
    load_profile_tokens,
    parse_env_file,
    write_app_config,
    write_profile_tokens,
)


class OAuthTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.config_dir = Path(self.temporary.name) / "whoop"
        self.config = AppConfig(
            "client-id",
            "client-secret",
            "https://dashboard.example.test/oauth/whoop/callback",
            DEFAULT_SCOPES,
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_authorization_url_contains_exact_state_scope_and_redirect(self) -> None:
        state = create_authorization_state("adult_a")
        parsed = urlparse(build_authorization_url(self.config, state))
        query = parse_qs(parsed.query)
        self.assertEqual(parsed.scheme, "https")
        self.assertEqual(query["state"], [state])
        self.assertEqual(query["scope"], [DEFAULT_SCOPES])
        self.assertEqual(query["redirect_uri"], [self.config.redirect_uri])
        self.assertNotIn("client-secret", parsed.geturl())
        self.assertNotIn("prompt", query)

    def test_state_is_unique_profile_bound_and_validated(self) -> None:
        first = create_authorization_state("adult_a")
        second = create_authorization_state("adult_a")
        self.assertNotEqual(first, second)
        self.assertTrue(first.startswith("adult_a."))
        self.assertEqual(
            validate_callback({"state": first, "code": "authorization-code"}, first),
            "authorization-code",
        )
        with self.assertRaises(OAuthError):
            validate_callback({"state": second, "code": "code"}, first)

    def test_token_response_requires_rotating_offline_pair(self) -> None:
        payload = {
            "access_token": "access",
            "refresh_token": "refresh",
            "expires_in": 3600,
            "scope": DEFAULT_SCOPES,
            "token_type": "bearer",
        }
        tokens = token_from_response(payload, now=1000)
        self.assertEqual(tokens.expires_at, 4540)
        self.assertIsNone(tokens.user_id)
        for missing in ("refresh_token", "scope"):
            invalid = dict(payload)
            invalid.pop(missing)
            with self.subTest(missing=missing), self.assertRaises(OAuthError):
                token_from_response(invalid, now=1000)

    def test_tokens_require_verified_identity_before_persistence(self) -> None:
        tokens = TokenSet("access", "refresh", 1234, DEFAULT_SCOPES)
        with self.assertRaises(ConfigError):
            write_profile_tokens(self.config_dir, "adult_a", tokens)
        verified = bind_verified_user(tokens, 90000001)
        write_profile_tokens(self.config_dir, "adult_a", verified)
        self.assertEqual(load_profile_tokens(self.config_dir, "adult_a"), verified)

    def test_family_configuration_requires_identity_and_offline_scopes(self) -> None:
        for scopes in ("read:profile", "offline read:recovery"):
            invalid = AppConfig(
                "client-id", "client-secret", self.config.redirect_uri, scopes
            )
            with self.subTest(scopes=scopes), self.assertRaises(ConfigError):
                write_app_config(self.config_dir, invalid)

    def test_duplicate_cached_account_is_rejected_across_profiles(self) -> None:
        first = TokenSet("a1", "r1", 1234, DEFAULT_SCOPES, 90000001)
        duplicate = TokenSet("a2", "r2", 5678, DEFAULT_SCOPES, 90000001)
        write_profile_tokens(self.config_dir, "adult_a", first)
        with self.assertRaisesRegex(ConfigError, "already authorized"):
            write_profile_tokens(self.config_dir, "adult_b", duplicate)
        self.assertFalse((self.config_dir / "profiles" / "adult_b.env").exists())

    def test_profiles_are_isolated_and_private(self) -> None:
        write_app_config(self.config_dir, self.config)
        for label, user_id in (("adult_a", 90000001), ("adult_b", 90000002)):
            write_profile_tokens(
                self.config_dir,
                label,
                TokenSet(f"a-{label}", f"r-{label}", 1234, DEFAULT_SCOPES, user_id),
            )
        self.assertNotEqual(
            load_profile_tokens(self.config_dir, "adult_a").access_token,
            load_profile_tokens(self.config_dir, "adult_b").access_token,
        )
        self.assertEqual(stat.S_IMODE(self.config_dir.stat().st_mode), 0o700)
        self.assertEqual(
            stat.S_IMODE((self.config_dir / "profiles" / "adult_a.env").stat().st_mode),
            0o600,
        )

    def test_env_parser_does_not_execute_shell_syntax(self) -> None:
        path = Path(self.temporary.name) / "safe.env"
        path.write_text("WHOOP_CLIENT_ID='$(touch should-not-exist)'\n")
        self.assertEqual(parse_env_file(path)["WHOOP_CLIENT_ID"], "$(touch should-not-exist)")
        self.assertFalse((Path.cwd() / "should-not-exist").exists())


if __name__ == "__main__":
    unittest.main()
