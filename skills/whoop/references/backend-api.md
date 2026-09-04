# Family dashboard backend API

This mock-only API defines the contract between the future ChatGPT Site and the
external wellness backend. It stores state in memory and loses all connections
when restarted. Never expose it as a production service.

## Authorization flow

1. `POST /api/v1/members/{profile}/whoop/authorizations`
2. Render `authorization_url` as both a link and QR code.
3. Poll `GET /api/v1/members/{profile}/whoop/authorizations/{id}`.
4. Stop polling when `status` is `authorized`, `denied`, or `expired`.

Each attempt uses an opaque, random state value and expires after ten minutes.
The QR contains no profile label or health data. In live mode, the authorization
URL will point to WHOOP and WHOOP will redirect to `/oauth/whoop/callback`.

## Routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Check mock backend readiness |
| `POST` | `/api/v1/members/{profile}/whoop/authorizations` | Start authorization |
| `GET` | `/api/v1/members/{profile}/whoop/authorizations/{id}` | Poll authorization |
| `GET` | `/api/v1/members/{profile}/whoop/status` | Read connection state |
| `GET` | `/api/v1/members/{profile}/wellness` | Read normalized mock data |
| `DELETE` | `/api/v1/members/{profile}/whoop` | Revoke the mock connection |

The wellness route accepts optional ISO-8601 `start` and `end` query values.
Responses always identify the profile, provider, and mock/live mode.

## Run in Docker

```bash
docker compose run --rm --service-ports whoop-dev \
  python scripts/mock_backend.py --public-base-url http://localhost:8787
```

Open `http://localhost:8787/health`. A phone cannot scan a QR containing
`localhost`; phone testing requires an HTTPS development tunnel and the tunnel
URL passed through `--public-base-url`.

## Production boundary

Replace the in-memory session and connection dictionaries with a database.
Encrypt rotating refresh tokens using a key that is not stored in that database.
Authenticate dashboard requests and enforce family membership on every route.
Fetch WHOOP `/v2/user/profile/basic` before saving a connection and reject a
WHOOP user ID already attached to another family profile.
