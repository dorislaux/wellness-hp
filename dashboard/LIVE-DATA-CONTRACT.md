# Live wellness data boundary

The dashboard reads one normalized household snapshot from server code. Browser
components never receive provider credentials and never call Oura or WHOOP
directly.

## Runtime modes

- `mock` is the default and uses only fictional records from `app/mock-data.ts`.
- `sites` uses authenticated Site server routes to call providers over HTTPS and
  read normalized records from D1.

The protected `GET /api/wellness` route applies the same ChatGPT identity and
household email allowlist as the page and returns `Cache-Control: private,
no-store`.

## Date and freshness invariant

Every snapshot describes exactly one local calendar date. Oura and WHOOP data
may be combined only when each source record belongs to that selected date and
is complete. Site server code must not silently substitute an older record.

If a provider has no complete record for the selected date:

1. omit that source's measurements for the affected member;
2. add a source issue with code `not_current` or `unavailable`; and
3. let the dashboard show one quiet refresh/reconnect state.

This preserves the product decision that mismatched dates signal a sync problem
rather than something the interface should explain with multiple measurement
dates.

## Required snapshot shape

```json
{
  "date": "2026-08-10",
  "dateLabel": "Monday, August 10",
  "members": [],
  "issues": [
    {
      "memberId": "adult_a",
      "source": "whoop",
      "code": "not_current",
      "message": "WHOOP has not synced for this day."
    }
  ]
}
```

Each member uses the existing `Member` contract in `app/mock-data.ts`. Provider
payloads are validated and normalized field by field at the Site server
boundary; unavailable values remain null rather than becoming zero.

## Provider responsibilities

Site server routes are responsible for:

- completing Oura and WHOOP OAuth callbacks;
- encrypting rotating refresh tokens with a key stored outside the database;
- binding each provider user ID to one household member;
- refreshing tokens and synchronizing source records;
- calculating 30-day personal baselines and derived percentages;
- enforcing household membership on every data request; and
- returning only the normalized fields required by the dashboard.

Raw provider payloads, authorization codes, access tokens, and refresh tokens
must never be returned to the browser or written to application logs.

## Retention windows

The application constants in `db/retention-policy.ts` define these cleanup
windows: OAuth attempts expire after 10 minutes and are removed within 24 hours;
normalized daily metrics are kept for 365 days; sleep-stage segments for 90
days; sync diagnostics for 14 days; and disconnected connection metadata for 30
days. Credentials are deleted immediately when a provider is disconnected.
