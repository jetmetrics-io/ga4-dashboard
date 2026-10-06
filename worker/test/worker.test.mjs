// Tests for the auth service with Google stubbed out. Run: node --test worker/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { sealSession, openSession } from "../src/index.js";

const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
const env = {
  GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "secret",
  SESSION_KEY: key(),
  STATE_KEY: key(),
  ALLOWED_ORIGINS: "https://jetmetrics.io,http://localhost:8080",
};
const API = "https://api.jetmetrics.io";
const PAGE = "https://jetmetrics.io";

// Google stub: records calls, answers like the token and revoke endpoints
let calls = [];
let tokenAnswer = () => ({ status: 200, body: { access_token: "at-1", expires_in: 3599, refresh_token: "rt-1", scope: "analytics.readonly email" } });
globalThis.fetch = async (url, init) => {
  const params = Object.fromEntries(new URLSearchParams(init.body));
  calls.push({ url: String(url), params });
  if (String(url).includes("/revoke")) return new Response("{}", { status: 200 });
  const a = tokenAnswer(params);
  return new Response(JSON.stringify(a.body), { status: a.status });
};

const call = (path, init = {}) => worker.fetch(new Request(API + path, init), env);
const post = (path, body, origin = PAGE) => call(path, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });

async function startState(origin = PAGE, extra = "") {
  const res = await call(`/auth/start?origin=${encodeURIComponent(origin)}${extra}`);
  assert.equal(res.status, 302);
  return new URL(res.headers.get("Location"));
}

function messageFrom(html) {
  const m = html.match(/var data = (\{.*?\}), target = ("[^"]*")/s);
  return { data: JSON.parse(m[1]), target: JSON.parse(m[2]) };
}

test("start sends the popup to Google with offline access, consent and a signed state", async () => {
  const g = await startState(PAGE, "&hint=mary%40jetmetrics.io");
  assert.equal(g.origin + g.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(g.searchParams.get("redirect_uri"), `${API}/auth/callback`);
  assert.equal(g.searchParams.get("access_type"), "offline");
  assert.equal(g.searchParams.get("prompt"), "consent");
  assert.equal(g.searchParams.get("login_hint"), "mary@jetmetrics.io");
  assert.match(g.searchParams.get("scope"), /analytics\.readonly/);
  assert.match(g.searchParams.get("state"), /^[\w-]+\.[\w-]+$/);
  assert.equal(g.searchParams.get("include_granted_scopes"), null, "only the dashboard's own scopes");
});

test("start refuses pages that are not allowed", async () => {
  const res = await call(`/auth/start?origin=${encodeURIComponent("https://evil.example")}`);
  assert.equal(res.status, 400);
});

test("callback exchanges the code and gives the page a token and an encrypted session", async () => {
  calls = [];
  const state = (await startState()).searchParams.get("state");
  const res = await call(`/auth/callback?code=c-1&state=${encodeURIComponent(state)}`);
  const { data, target } = messageFrom(await res.text());
  assert.equal(target, PAGE);
  assert.equal(data.ok, true);
  assert.equal(data.access_token, "at-1");
  assert.ok(data.session && !data.session.includes("rt-1"), "refresh token is encrypted");
  assert.equal(await openSession(env, data.session), "rt-1");
  assert.equal(calls[0].params.grant_type, "authorization_code");
  assert.equal(calls[0].params.client_secret, "secret");
});

test("callback rejects a tampered or expired state", async () => {
  const state = (await startState()).searchParams.get("state");
  const [payload, sig] = state.split(".");
  const forged = `${payload}x.${sig}`;
  let msg = messageFrom(await (await call(`/auth/callback?code=c&state=${forged}`)).text());
  assert.equal(msg.data.ok, false);
  assert.equal(msg.target, "", "nothing is posted without a valid state");
  const old = Date.now;
  Date.now = () => old() + 11 * 60 * 1000;
  msg = messageFrom(await (await call(`/auth/callback?code=c&state=${encodeURIComponent(state)}`)).text());
  Date.now = old;
  assert.equal(msg.data.ok, false);
});

test("callback passes Google's refusal back to the page", async () => {
  const state = (await startState()).searchParams.get("state");
  const msg = messageFrom(await (await call(`/auth/callback?error=access_denied&state=${encodeURIComponent(state)}`)).text());
  assert.deepEqual([msg.data.ok, msg.data.error, msg.target], [false, "access_denied", PAGE]);
});

test("refresh turns the session into a fresh access token, only for allowed pages", async () => {
  const session = await sealSession(env, "rt-9");
  tokenAnswer = (p) => (p.refresh_token === "rt-9" ? { status: 200, body: { access_token: "at-9", expires_in: 3599 } } : { status: 400, body: { error: "invalid_grant" } });
  let res = await post("/auth/refresh", { session });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).access_token, "at-9");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), PAGE);
  res = await post("/auth/refresh", { session }, "https://evil.example");
  assert.equal(res.status, 403);
});

test("refresh says 401 for a broken session or a revoked grant", async () => {
  let res = await post("/auth/refresh", { session: "garbage" });
  assert.equal(res.status, 401);
  const session = await sealSession(env, "rt-revoked");
  res = await post("/auth/refresh", { session });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "invalid_grant");
});

test("a session sealed with another key does not open", async () => {
  const other = { ...env, SESSION_KEY: key() };
  const session = await sealSession(other, "rt-x");
  assert.equal(await openSession(env, session), null);
});

test("revoke calls Google with the refresh token", async () => {
  calls = [];
  const session = await sealSession(env, "rt-5");
  const res = await post("/auth/revoke", { session });
  assert.equal(res.status, 200);
  assert.equal(calls[0].params.token, "rt-5");
});

test("CORS preflight is answered only for allowed pages", async () => {
  let res = await call("/auth/refresh", { method: "OPTIONS", headers: { Origin: PAGE } });
  assert.equal(res.status, 204);
  res = await call("/auth/refresh", { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
  assert.equal(res.status, 403);
});
