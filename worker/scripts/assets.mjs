// Copies the dashboard's files into public/, which this Worker serves as static assets:
// https://api.jetmetrics.io/funnel-dashboard/app/<file>. Runs before every deploy (npm run deploy).
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

const FILES = ["shell.js", "core.js", "app.js", "template.html", "claude_prompt.md"];
const out = new URL("../public/", import.meta.url);
const app = new URL("funnel-dashboard/app/", out);

rmSync(out, { recursive: true, force: true });
mkdirSync(app, { recursive: true });
for (const f of FILES) cpSync(new URL(`../../${f}`, import.meta.url), new URL(f, app));
// The page fetches template.html and claude_prompt.md from jetmetrics.io; no-cache = browsers check
// for a new version on every load (an unchanged file answers 304), so a deploy shows up at once.
writeFileSync(new URL("_headers", out), "/funnel-dashboard/app/*\n  Access-Control-Allow-Origin: *\n  Cache-Control: no-cache\n");
console.log(`assets: ${FILES.length} files → public/funnel-dashboard/app/`);
