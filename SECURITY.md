# Security policy

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository. If that option is unavailable, open a public issue containing only a request for a private contact channel.

Never include any of the following in an issue, discussion, pull request, test fixture, screenshot, or log:

- Oura client IDs or client secrets
- WHOOP client IDs or client secrets
- access tokens, refresh tokens, authorization codes, or callback URLs containing codes
- raw Oura or WHOOP API responses or health records
- populated `app.env` or profile `.env` files

Revoke exposed Oura or WHOOP credentials immediately before reporting the incident.

The hosted dashboard must keep provider credentials server-side, reject
unauthenticated requests, enforce the household allowlist on every health-data
route, and return private, non-cacheable responses. Production refresh tokens
must be encrypted with a key that is not stored in the same database.

## Supported versions

Security fixes are made on the latest `main` branch. This project does not currently publish versioned releases.
