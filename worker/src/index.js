// JetMetrics auth service (Cloudflare Worker) — api.jetmetrics.io
//
// Signs people in to Google with the authorization-code flow and keeps them signed in:
//   GET  /auth/start     → redirects the sign-in popup to Google (read-only Analytics + email)
//   GET  /auth/callback  → exchanges Google's code for tokens, hands them to the dashboard page
//   POST /auth/refresh   → a fresh one-hour access token from the stored session
//   POST /auth/revoke    → disconnects: revokes the Google grant
//
// Stateless: the long-lived Google refresh token is encrypted with SESSION_KEY and kept by the
// browser as an opaque "session". Nothing is stored here, and Google Analytics data never passes
// through this service — the browser calls Google directly with the access token.
//
// Config (wrangler.toml [vars]): GOOGLE_CLIENT_ID, ALLOWED_ORIGINS (comma-separated page origins).
// Secrets (wrangler secret put): GOOGLE_CLIENT_SECRET, SESSION_KEY (base64, 32 bytes), STATE_KEY (base64, 32 bytes).

const SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

// ── Encoding and crypto ──────────────────────────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes) {
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function fromB64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

async function aesKey(env) {
  return crypto.subtle.importKey("raw", fromB64(env.SESSION_KEY), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function hmacKey(env) {
  return crypto.subtle.importKey("raw", fromB64(env.STATE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

// Session = AES-GCM(refresh token), opaque to the browser.
export async function sealSession(env, refreshToken) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify({ v: 1, rt: refreshToken, iat: Date.now() }));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), data));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64url(out);
}

export async function openSession(env, session) {
  try {
    const raw = fromB64url(String(session || ""));
    if (raw.length < 13) return null;
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await aesKey(env), raw.slice(12));
    const obj = JSON.parse(dec.decode(pt));
    return obj && obj.v === 1 && obj.rt ? obj.rt : null;
  } catch (e) {
    return null;
  }
}

// State = payload.signature; carries the page origin through Google's redirect.
async function makeState(env, origin) {
  const payload = b64url(enc.encode(JSON.stringify({ o: origin, t: Date.now(), n: b64url(crypto.getRandomValues(new Uint8Array(12))) })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

async function readState(env, state) {
  try {
    const [payload, sig] = String(state || "").split(".");
    if (!payload || !sig) return null;
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(env), fromB64url(sig), enc.encode(payload));
    if (!ok) return null;
    const obj = JSON.parse(dec.decode(fromB64url(payload)));
    if (!obj || typeof obj.t !== "number" || Date.now() - obj.t > STATE_MAX_AGE_MS) return null;
    return allowedOrigins(env).includes(obj.o) ? obj : null;
  } catch (e) {
    return null;
  }
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function cors(env, request) {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" };
}

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
}

async function google(env, url, params) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

// The popup's last page: passes the result to the dashboard page (only to the origin that started it) and closes.
function resultPage(origin, message) {
  const data = JSON.stringify({ jm: "auth", ...message }).replace(/</g, "\\u003c");
  const target = JSON.stringify(origin || "");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>JetMetrics Funnel Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1A1A1A;margin:0;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px}</style></head>
<body><p id="m">${message.ok ? "Connected. You can close this window." : "Sign-in didn't finish. You can close this window and try again."}</p>
<script>
var data = ${data}, target = ${target};
if (window.opener && target) { window.opener.postMessage(data, target); window.close(); }
</script></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

// ── Routes ───────────────────────────────────────────────────────────────────

async function start(request, env) {
  const url = new URL(request.url);
  const origin = url.searchParams.get("origin") || "";
  if (!allowedOrigins(env).includes(origin)) return new Response("This page can't sign in here.", { status: 400 });
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${url.origin}/auth/callback`,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    // No include_granted_scopes: the grant holds exactly the two scopes above, nothing granted to other clients earlier
    // consent → Google returns a refresh token every time; select_account → "Use another account"
    prompt: url.searchParams.get("select") ? "consent select_account" : "consent",
    state: await makeState(env, origin),
  });
  const hint = url.searchParams.get("hint");
  if (hint) params.set("login_hint", hint);
  return Response.redirect(`${env.GOOGLE_AUTH_URL || GOOGLE_AUTH_URL}?${params}`, 302);
}

async function callback(request, env) {
  const url = new URL(request.url);
  const st = await readState(env, url.searchParams.get("state"));
  if (!st) return resultPage("", { ok: false, error: "bad_state" });
  const error = url.searchParams.get("error");
  if (error) return resultPage(st.o, { ok: false, error });
  const code = url.searchParams.get("code");
  if (!code) return resultPage(st.o, { ok: false, error: "no_code" });
  const r = await google(env, env.GOOGLE_TOKEN_URL || GOOGLE_TOKEN_URL, {
    code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: `${url.origin}/auth/callback`, grant_type: "authorization_code",
  });
  if (!r.ok || !r.body.access_token) return resultPage(st.o, { ok: false, error: r.body.error || "exchange_failed" });
  return resultPage(st.o, {
    ok: true,
    access_token: r.body.access_token,
    expires_in: r.body.expires_in,
    scope: r.body.scope,
    session: r.body.refresh_token ? await sealSession(env, r.body.refresh_token) : null,
  });
}

async function refresh(request, env, headers) {
  const body = await request.json().catch(() => ({}));
  const rt = await openSession(env, body.session);
  if (!rt) return json({ error: "invalid_session" }, 401, headers);
  const r = await google(env, env.GOOGLE_TOKEN_URL || GOOGLE_TOKEN_URL, {
    refresh_token: rt, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, grant_type: "refresh_token",
  });
  if (!r.ok || !r.body.access_token) {
    // invalid_grant = revoked or expired: the browser has to sign in again
    const status = r.body.error === "invalid_grant" ? 401 : 502;
    return json({ error: r.body.error || "refresh_failed" }, status, headers);
  }
  return json({ access_token: r.body.access_token, expires_in: r.body.expires_in, scope: r.body.scope }, 200, headers);
}

async function revoke(request, env, headers) {
  const body = await request.json().catch(() => ({}));
  const rt = await openSession(env, body.session);
  if (rt) await google(env, env.GOOGLE_REVOKE_URL || GOOGLE_REVOKE_URL, { token: rt });
  return json({ ok: true }, 200, headers);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const headers = cors(env, request);
    if (request.method === "OPTIONS") return new Response(null, { status: Object.keys(headers).length ? 204 : 403, headers });
    if (request.method === "GET" && pathname === "/auth/start") return start(request, env);
    if (request.method === "GET" && pathname === "/auth/callback") return callback(request, env);
    if (request.method === "POST" && (pathname === "/auth/refresh" || pathname === "/auth/revoke")) {
      if (!Object.keys(headers).length) return json({ error: "origin_not_allowed" }, 403);
      return pathname === "/auth/refresh" ? refresh(request, env, headers) : revoke(request, env, headers);
    }
    if (request.method === "GET" && pathname === "/") return new Response("JetMetrics auth service", { headers: { "Content-Type": "text/plain" } });
    return new Response("Not found", { status: 404 });
  },
};
