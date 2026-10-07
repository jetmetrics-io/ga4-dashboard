# JetMetrics Funnel Dashboard API

Cloudflare Worker `funnel-dashboard-api` at `https://api.jetmetrics.io/funnel-dashboard/`. The `api.jetmetrics.io` host is meant for all JetMetrics products, so each product keeps its routes under its own prefix. It keeps people signed in to Google without a click every hour, using Google's recommended authorization-code flow:

| Route | What it does |
|---|---|
| `GET /funnel-dashboard/auth/start?origin=…&hint=…` | Opens in the sign-in popup and redirects to Google (read-only Analytics + email, offline access) |
| `GET /funnel-dashboard/auth/callback` | Exchanges Google's code for tokens and passes them to the dashboard page with `postMessage` (only to the page that started the sign-in) |
| `POST /funnel-dashboard/auth/refresh {session}` | Returns a fresh one-hour access token |
| `POST /funnel-dashboard/auth/revoke {session}` | Revokes the Google grant (Disconnect) |

**Access check** (`ACCESS_CHECK = "on"`). After Google sign-in the service reads the account's verified email and asks Gumroad (`GET /v2/sales?email=…&product_id=…`) whether it has one of `GUMROAD_PRODUCTS`, not refunded. No → no tokens, the Google grant is revoked, and the page gets `{error: "no_access", email, access_url}` to show where to get access. Gumroad not answering → the person is let in and checked again on the next refresh. A confirmed check is sealed into the session, so it isn't repeated every hour. Off while Google reviews the app (reviewers have no purchase).

**Stateless.** The Google refresh token is encrypted (AES-GCM, `SESSION_KEY`) and kept by the browser as an opaque session. Nothing is stored here, and Google Analytics data never passes through the service: the browser calls Google directly with the access token.

**The dashboard's files.** `npm run deploy` first copies `shell.js`, `core.js`, `app.js`, `template.html` and `claude_prompt.md` from the repo root into `public/funnel-dashboard/app/` (`scripts/assets.mjs`); the Worker serves them as static assets at `https://api.jetmetrics.io/funnel-dashboard/app/<file>` with `Access-Control-Allow-Origin: *` and `Cache-Control: no-cache`. `public/` is generated, not committed.

**Old paths.** `/auth/…` (before 06.10.26) is still answered as `/funnel-dashboard/auth/…` for pages that loaded an old app.js; remove once no page loads files from jsDelivr.

## Config

- `wrangler.toml` → `[vars]`: `GOOGLE_CLIENT_ID`, `ALLOWED_ORIGINS` (page origins allowed to sign in).
- `[vars]` for the access check: `ACCESS_CHECK` (`on`/`off`), `GUMROAD_PRODUCTS` (product IDs that give access, comma-separated), `ACCESS_URL` (where to get access).
- Secrets: `GOOGLE_CLIENT_SECRET` (the web OAuth client's secret), `SESSION_KEY` and `STATE_KEY` (random 32 bytes, base64), `GUMROAD_TOKEN` (Gumroad API access token, needed with the access check on). Changing `SESSION_KEY` signs everyone out.
- The worker is bound to the whole `api.jetmetrics.io` host (custom domain). When a second product needs the host, switch to routes per prefix (`api.jetmetrics.io/funnel-dashboard/*`); the URLs stay the same.
- Google Cloud: the OAuth client needs `https://api.jetmetrics.io/funnel-dashboard/auth/callback` under "Authorized redirect URIs".

## Run

```
npm test                       # Google stubbed out
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npx wrangler@4 deploy
```
