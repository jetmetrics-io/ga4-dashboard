# JetMetrics auth service

Cloudflare Worker at `https://api.jetmetrics.io`. It keeps people signed in to Google without a click every hour, using Google's recommended authorization-code flow:

| Route | What it does |
|---|---|
| `GET /auth/start?origin=…&hint=…` | Opens in the sign-in popup and redirects to Google (read-only Analytics + email, offline access) |
| `GET /auth/callback` | Exchanges Google's code for tokens and passes them to the dashboard page with `postMessage` (only to the page that started the sign-in) |
| `POST /auth/refresh {session}` | Returns a fresh one-hour access token |
| `POST /auth/revoke {session}` | Revokes the Google grant (Disconnect) |

**Stateless.** The Google refresh token is encrypted (AES-GCM, `SESSION_KEY`) and kept by the browser as an opaque session. Nothing is stored here, and Google Analytics data never passes through the service: the browser calls Google directly with the access token.

## Config

- `wrangler.toml` → `[vars]`: `GOOGLE_CLIENT_ID`, `ALLOWED_ORIGINS` (page origins allowed to sign in).
- Secrets: `GOOGLE_CLIENT_SECRET` (the web OAuth client's secret), `SESSION_KEY` and `STATE_KEY` (random 32 bytes, base64). Changing `SESSION_KEY` signs everyone out.
- Google Cloud: the OAuth client needs `https://api.jetmetrics.io/auth/callback` under "Authorized redirect URIs".

## Run

```
npm test                       # Google stubbed out
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npx wrangler@4 deploy
```
