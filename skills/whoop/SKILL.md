---
name: whoop
description: Use when a user asks to retrieve, inspect, summarize, compare, or analyze WHOOP cycle, recovery, sleep, or workout data. Supports synthetic mock data during development; live WHOOP access is not yet implemented.
---

# WHOOP

Use the bundled dependency-free Python CLI. It currently reads only fictional
fixtures and never contacts WHOOP.

## Safety

- Use `--mock` for every data retrieval.
- Never describe mock records as the user's health data.
- Treat absent scores as missing or pending, never as zero.
- Keep cycles as sleep-to-sleep physiological periods rather than calendar days.
- Do not infer that Oura and WHOOP scores are directly interchangeable.

## Workflow

Resolve `scripts/whoop.py` relative to this `SKILL.md` and use its absolute path.

1. Run `resources` to list the allowlisted resources.
2. Run `status --mock` to confirm fixture availability.
3. Run `get RESOURCE --mock`, optionally with `--start`, `--end`, `--limit`, or
   `--all-pages`.
4. Read [references/endpoints.md](references/endpoints.md) for resource meanings,
   scopes, and time semantics.
5. Read [references/oauth.md](references/oauth.md) before adding or authorizing
   family profiles.
6. Read [references/backend-api.md](references/backend-api.md) when developing
   the family dashboard or QR authorization flow.

```bash
python /absolute/path/scripts/whoop.py resources
python /absolute/path/scripts/whoop.py status --mock
python /absolute/path/scripts/whoop.py get recovery --mock --all-pages
```

The supported resources are `cycles`, `recovery`, `sleep`, and `workouts`.
Report the selected mode and requested time range in summaries.

For mock dashboard development, run `scripts/mock_backend.py`. Keep it local;
its authorization sessions and connections are intentionally in-memory and it
does not implement dashboard-user authentication.
