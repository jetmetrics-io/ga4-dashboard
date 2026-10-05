# JetMetrics GA4 Funnel Dashboard (prototype)

A GA4 e-commerce funnel dashboard that runs entirely in the browser: the user signs in with Google, picks a GA4 property, and the page calls the GA4 Data API directly. No backend; report data never leaves the user's browser.

## Files

| File | What it is |
|---|---|
| `index.html` | Local development page (`python3 -m http.server 8080 --bind 127.0.0.1`, open http://localhost:8080) |
| `config.js` | OAuth Client ID (public by design) and asset base for local development |
| `shell.js` | App shell: scoped CSS and controls, mounted into `#jm-app` |
| `core.js` | GA4 query plan (13 reports in 3 `batchRunReports` calls), metric calculations for the Map, Tree and Segments tabs, template filling. Exposes `window.JMCore` |
| `app.js` | Google sign-in (GIS token model), property list (Admin API), data loading, targets, rendering. Exposes `window.JMApp` for debugging |
| `template.html` | Dashboard template with `{{PLACEHOLDERS}}` |
| `claude_prompt.md` | Analysis brief (JetMetrics methodology) that "Copy for Claude" puts above the dashboard data. Plain text — edit freely |
| `tilda/dashboard-beta.html` | The HTML block pasted into the Tilda page; loads these files from jsDelivr |

## Updating the live page

The Tilda block loads files from `cdn.jsdelivr.net/gh/jetmetrics-io/ga4-dashboard@main/` with a `?v=` suffix that changes every 10 minutes (jsDelivr lets browsers cache files for a week). After pushing to `main`, purge the CDN cache for changed files:

```
curl https://purge.jsdelivr.net/gh/jetmetrics-io/ga4-dashboard@main/app.js
```

## Notes

- The OAuth client must list every page origin under "Authorized JavaScript origins" (`http://localhost:8080`, `https://jetmetrics.io`).
- Before public launch: Google verification of the `analytics.readonly` scope, and the sign-in moves to the authorization-code flow through a small licensing/auth worker.
