---
name: whoop
description: Use when a user asks to retrieve, inspect, compare, export, summarize, or analyze WHOOP data, including cycles, recovery, sleep, workouts, strain, or profile/body-measurement information.
---

# WHOOP

Use the bundled dependency-free Python CLI for WHOOP API v2 access. It handles OAuth, rotating-refresh-token renewal, pagination, bounded retries, and isolated profiles. Prefer it to direct `curl` calls.

## Safety contract

- Never ask the user to paste a client secret, access token, refresh token, authorization code, or callback URL containing a code into chat.
- Have the user run `configure` and `authorize` in their own terminal. `configure` obtains the client secret with a hidden prompt and saves private files locally.
- Never pass secrets as command-line arguments, print configuration files, or expose raw WHOOP responses unless the user explicitly asks for the raw data.
- Treat WHOOP output as sensitive health data. Return only what the request needs and do not persist or publish it unless explicitly asked.
- Use `default` when no profile is specified. Before accessing another profile, name it explicitly and confirm the intended profile.
- Keep OAuth tokens and records isolated by profile. Only combine profiles for an explicitly requested comparison, and label every result.
- Treat absent records as missing data, not zero. State the profile and requested date or datetime range in summaries.
- WHOOP rotates the refresh token on every use; never report a stale refresh token as valid, and if reauthorization is required, say so rather than retrying indefinitely.

## Locate the CLI

Resolve the CLI from the skill that was actually loaded: take the absolute directory containing this `SKILL.md`, append `scripts/whoop.py`, and use that absolute path for every command. Do not assume a particular installation directory or invoke a different checkout.

```bash
python3 /absolute/path/to/the/loaded/whoop-skill/scripts/whoop.py COMMAND
```

The CLI uses only the Python standard library; do not install packages for normal use.

## Workflow

1. Run `status`. This is safe before configuration and never prints credentials.
2. If app credentials are missing, ask the user to run `configure` in their own terminal. The default profile is `default`, and the default redirect URI is `http://localhost:8911/callback` (deliberately different from the Oura skill's `:8910`, so both can be authorized independently in the same terminal).
3. If the selected profile is not authorized, ask the user to run `authorize --profile default --open-browser`. The loopback listener validates OAuth state before saving tokens.
4. For a daily overview, run `daily --start-date YYYY-MM-DD --end-date YYYY-MM-DD --profile default`. The result contains cycle, recovery, and sleep for one profile across that date range.
5. For other data, run `resources`, then `get RESOURCE` with `--start-datetime`, `--end-datetime`, or `--all-pages` as needed. WHOOP's collection endpoints require full ISO 8601 datetimes, not calendar dates.
6. Read [references/endpoints.md](references/endpoints.md) for the allowlisted resource map, expected OAuth scopes, and WHOOP-specific quirks (the `records`/`next_token`/`nextToken` pagination shape, refresh-token rotation).

To add another person or band account, authorize a separate profile such as `secondary`. The WHOOP application credentials are shared locally, while OAuth tokens remain profile-specific. Change the default only when explicitly requested with `default-profile PROFILE`.

## Combining with Oura

If both the `oura` and `whoop` skills are installed and a request spans both (for example, sleep from one provider and workouts from the other), call each skill's `daily` command independently for the matching date range and present the results labeled by provider and profile — never merge two people's data, and never impute one provider's missing metric from the other's numbers.

## Error handling

- `401`: the CLI refreshes once. If authorization still fails, ask the user to reauthorize that profile.
- `403`: explain that OAuth consent may lack the resource's scope; do not claim the data is absent.
- `429` or `5xx`: the CLI retries within a fixed bound. Report failure without an unbounded retry loop.
- Empty results: mention the requested range, possible WHOOP sync delay, and that missing data is not a zero value.
- Network failure: report it as a connectivity problem before suggesting reauthorization.

Use the [official WHOOP API documentation](https://developer.whoop.com/docs/introduction/) when current API behavior must be verified — this environment's network policy may block that domain directly, in which case ask the user to check it, or use a general web search as a fallback.
