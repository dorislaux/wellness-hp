#!/usr/bin/env python3
"""Mock-first command-line client for WHOOP API v2 resources."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Mapping

SKILL_DIR = Path(__file__).resolve().parent.parent
if str(SKILL_DIR) not in sys.path:
    sys.path.insert(0, str(SKILL_DIR))

from whoop_client import MockTransport, RESOURCE_SPECS, WhoopClient, WhoopError


def fixture_dir() -> Path:
    return SKILL_DIR / "fixtures"


def resources_payload() -> dict[str, object]:
    return {
        "mode": "mock",
        "resources": {
            name: {"path": spec.path, "scope": spec.scope}
            for name, spec in RESOURCE_SPECS.items()
        },
    }


def status_payload(directory: Path | None = None) -> tuple[dict[str, object], int]:
    transport = MockTransport(directory or fixture_dir())
    missing = transport.missing_fixtures()
    return (
        {
            "mode": "mock",
            "ready": not missing,
            "live_access": False,
            "missing_fixtures": missing,
        },
        0 if not missing else 2,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("resources", help="List allowlisted resources")

    status = subparsers.add_parser("status", help="Check mock fixture readiness")
    status.add_argument("--mock", action="store_true", required=True)

    get_parser = subparsers.add_parser("get", help="Read a mock resource")
    get_parser.add_argument("resource")
    get_parser.add_argument("--mock", action="store_true", required=True)
    get_parser.add_argument("--start")
    get_parser.add_argument("--end")
    get_parser.add_argument("--limit", type=int, default=10)
    get_parser.add_argument("--all-pages", action="store_true")
    return parser


def write_json(payload: Mapping[str, object]) -> None:
    json.dump(payload, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "resources":
            payload = resources_payload()
            exit_code = 0
        elif args.command == "status":
            payload, exit_code = status_payload()
        elif args.command == "get":
            client = WhoopClient(MockTransport(fixture_dir()))
            payload = client.get(
                args.resource,
                start=args.start,
                end=args.end,
                limit=args.limit,
                all_pages=args.all_pages,
            )
            exit_code = 0
        else:
            raise WhoopError("Unknown command.")
        write_json(payload)
        return exit_code
    except WhoopError as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
