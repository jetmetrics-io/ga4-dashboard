# JetMetrics GA4 Funnel Dashboard (prototype)

A GA4 e-commerce funnel dashboard that runs entirely in the browser: the user signs in with Google, picks a GA4 property, and the page calls the GA4 Data API directly. No backend; report data never leaves the user's browser.

## Files

| File | What it is |
|---|---|
| `index.html` | Local development page (`python3 -m http.server 8080 --bind 127.0.0.1`, open http://localhost:8080) |
| `config.js` | OAuth Client ID (public by design) and asset base for local development |
| `shell.js` | App shell: scoped CSS and markup of the header (data button, period and segment filters, Copy for Claude, menu), messages, targets panel; mounted into `#jm-app` |
| `core.js` | GA4 query plan (15 reports in 3 `batchRunReports` calls), metric calculations for the Map, Tree and Segments tabs, template filling. Exposes `window.JMCore` |
| `app.js` | Google sign-in (GIS token model), property list (Admin API), period presets with their usual comparison (PoP), segment filters, data loading, targets, rendering. Exposes `window.JMApp` for debugging |
| `template.html` | Dashboard template with `{{PLACEHOLDERS}}`: Map or Tree on the left (title + view switch), Segments on the right |
| `claude_prompt.md` | Analysis brief (JetMetrics methodology) that "Copy for Claude" puts above the dashboard data. Plain text — edit freely |
| `tilda/funnel-dashboard.html` | The HTML block pasted into the Tilda page; loads these files from jsDelivr |
| `tilda/privacy.html` | The privacy policy block for jetmetrics.io/funnel-dashboard-privacy (static, pasted into Tilda as is) |
| `worker/` | The dashboard's API on Cloudflare Workers (`api.jetmetrics.io/funnel-dashboard/`): sign-in with Google's code flow, silent token renewal from an encrypted session kept in the browser. See `worker/README.md` |

## Updating the live page

The Tilda block loads files from `cdn.jsdelivr.net/gh/jetmetrics-io/ga4-dashboard@main/` with a `?v=` suffix that changes every 10 minutes (jsDelivr lets browsers cache files for a week). After pushing to `main`, purge the CDN cache for changed files:

```
curl https://purge.jsdelivr.net/gh/jetmetrics-io/ga4-dashboard@main/app.js
```

Wait ~15 seconds after the push before purging (a purge sent too early keeps the old version), then check the file on the CDN.

## Notes

- The OAuth client must list every page origin under "Authorized JavaScript origins" (`http://localhost:8080`, `https://jetmetrics.io`).
- On jetmetrics.io the sign-in goes through `worker/` (authorization-code flow); elsewhere the page falls back to the browser-only token flow.
- Names shared across jetmetrics.io carry the product: browser storage keys start with `jm.funnel.`, API routes with `/funnel-dashboard/`, the privacy page is `/funnel-dashboard-privacy`.
- Before public launch: Google verification of the `analytics.readonly` scope.
