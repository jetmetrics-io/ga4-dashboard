# JetMetrics GA4 Funnel Dashboard (prototype)

A GA4 e-commerce funnel dashboard that runs entirely in the browser: the user signs in with Google, picks a GA4 property, and the page calls the GA4 Data API directly. Report data never leaves the user's browser; our small API (`worker/`) only handles sign-in and serves the files.

It is the first of **JetMetrics Web Dashboards**: one Google app (consent screen, verification, privacy policy) for all our web dashboards on GA4. Home page jetmetrics.io/web-dashboards, privacy policy jetmetrics.io/web-dashboards-privacy.

## Files

| File | What it is |
|---|---|
| `index.html` | Local development page (`python3 -m http.server 8080 --bind 127.0.0.1`, open http://localhost:8080) |
| `config.js` | OAuth Client ID (public by design) and asset base for local development |
| `shell.js` | App shell: scoped CSS and markup of the header (data button, period and segment filters, Copy for Claude, menu), messages, targets panel; mounted into `#jm-app` |
| `core.js` | GA4 query plan (15 reports in 3 `batchRunReports` calls), metric calculations for the Map, Tree and Segments tabs, template filling. Exposes `window.JMCore` |
| `app.js` | Google sign-in (GIS token model), property list (Admin API), period presets with their usual comparison (PoP), segment filters, data loading, targets, rendering. Exposes `window.JMApp` for debugging |
| `demo.js` | Demo store with sample data (fashion DTC, ~400k sessions a month, two built-in stories): answers the dashboard's GA4 requests in the browser, any period and filter. Loaded on "See a live demo" or `?demo` |
| `template.html` | Dashboard template with `{{PLACEHOLDERS}}`: Map or Tree on the left (title + view switch), Segments on the right |
| `claude_prompt.md` | Analysis brief (JetMetrics methodology) that "Copy for Claude" puts above the dashboard data. Plain text — edit freely |
| `tilda/funnel-dashboard.html` | The HTML block of jetmetrics.io/funnel-dashboard; loads these files from `api.jetmetrics.io/funnel-dashboard/app/` |
| `tilda/web-dashboards.html` | The block of jetmetrics.io/web-dashboards: home page of JetMetrics Web Dashboards, one card per dashboard |
| `tilda/web-dashboards-privacy.html` | The block of jetmetrics.io/web-dashboards-privacy: privacy policy of JetMetrics Web Dashboards |
| `worker/` | The dashboard's API on Cloudflare Workers (`api.jetmetrics.io/funnel-dashboard/`): sign-in with Google's code flow, silent token renewal from an encrypted session kept in the browser, access check on Gumroad, and the dashboard's files. See `worker/README.md` |

## Updating the live page

The page loads the dashboard's files from our API, `https://api.jetmetrics.io/funnel-dashboard/app/` (static assets of `worker/`, `Cache-Control: no-cache`: browsers check for a new version on every load). After changing `shell.js`, `core.js`, `app.js`, `template.html` or `claude_prompt.md`, deploy the worker; the change is live at once:

```
cd worker && CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npm run deploy
```

Until 07.10.26 the files came from jsDelivr (`@main`); it served stale versions for hours, so it is no longer used.

## Notes

- The OAuth client must list every page origin under "Authorized JavaScript origins" (`http://localhost:8080`, `https://jetmetrics.io`).
- On jetmetrics.io the sign-in goes through `worker/` (authorization-code flow); elsewhere the page falls back to the browser-only token flow.
- Names shared across jetmetrics.io carry the product: browser storage keys start with `jm.funnel.`, API routes with `/funnel-dashboard/`. What belongs to all web dashboards carries `web-dashboards` (home page, privacy policy, the Google app's name).
- Before public launch: Google verification of the `analytics.readonly` scope.
