# Synthetic WHOOP fixtures

These files contain fictional data shaped like WHOOP Developer API v2
responses. They contain no real credentials, identifiers, or health records.

The records are linked consistently by `user_id`, `cycle_id`, and `sleep_id`.
Cycle collection page 1 includes a `next_token`; page 2 terminates pagination
by omitting that optional field. The
newest cycle is deliberately `PENDING_SCORE` so clients must handle a missing
score instead of treating it as zero.

Fixtures:

- `profile.json`: `GET /developer/v2/user/profile/basic`
- `body_measurement.json`: `GET /developer/v2/user/measurement/body`
- `cycles_page_1.json` and `cycles_page_2.json`: paginated cycle collection
- `recoveries.json`: recovery collection
- `sleeps.json`: sleep collection
- `workouts.json`: workout collection

All timestamps use UTC. Values are plausible test values, not medical advice
and not a statistical model of a real person.
