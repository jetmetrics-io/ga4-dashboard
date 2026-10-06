// JetMetrics GA4 dashboard — prototype app shell.
// Google sign-in in the browser (GIS token model), GA4 Admin API for the property list,
// GA4 Data API batchRunReports for data. Nothing leaves the browser except calls to Google.

(function () {
  "use strict";

  const { SEGMENT_DIMS, buildPeriods, requestPlan, chunk, reportRows, toGa4Data, processMap, buildVerdicts, autoTargets, processTree, processSegments, buildSummary, fillTemplate } = window.JMCore;

  const SCOPE_GA = "https://www.googleapis.com/auth/analytics.readonly";
  // Email (non-sensitive) lets Google skip the account chooser on the next sign-in.
  const SCOPE = `${SCOPE_GA} https://www.googleapis.com/auth/userinfo.email`;
  const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
  const DATA = "https://analyticsdata.googleapis.com/v1beta";

  const FILTERS = [["user_type", "User type"], ["traffic_source", "Traffic source"], ["device", "Device"], ["landing_page", "Landing page"]];
  const LP_OPTIONS = 200;

  const state = {
    token: null, tokenExp: 0, tokenClient: null, expired: false,
    properties: [], propertyId: null,
    template: null, lastData: null, loading: false, loadedAt: 0, seq: 0,
    view: null, filters: {}, options: {},
  };
  FILTERS.forEach(([k]) => { state.filters[k] = []; state.options[k] = []; });

  const $ = (id) => document.getElementById(id);
  const I = () => window.JMShell.icons;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Cache-busting suffix for files on the CDN (set by the Tilda block).
  function assetVersion() {
    return window.JM_CONFIG && JM_CONFIG.v ? `?v=${JM_CONFIG.v}` : "";
  }

  function store(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ }
  }

  function load(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function unstore(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  const property = () => state.properties.find((p) => p.id === state.propertyId) || null;

  // ── Messages: one bar under the header, only when there is something to say ─

  function message(text, kind = "info", actions = []) {
    $("msg").className = `jm-msg jm-${kind}`;
    $("msgText").textContent = text;
    $("msgAct").innerHTML = "";
    actions.forEach((a) => {
      const el = document.createElement(a.href ? "a" : "button");
      el.textContent = a.label;
      if (a.href) { el.href = a.href; el.target = "_blank"; el.rel = "noopener"; } else { el.type = "button"; el.addEventListener("click", a.onClick); }
      $("msgAct").appendChild(el);
    });
    $("msg").hidden = false;
    clearTimeout(state.msgTimer);
    if (kind === "ok") state.msgTimer = setTimeout(clearMessage, 8000);
  }

  function clearMessage() {
    $("msg").hidden = true;
  }

  function setLoading(on) {
    state.loading = on;
    $("progress").hidden = !on;
    $("jm-app").classList.toggle("jm-loading", on && !!state.lastData);
    renderEmpty();
  }

  // ── Dates ──────────────────────────────────────────────────────────────────

  const DAY = 86400000;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const D = (y, m, d) => new Date(Date.UTC(y, m, d)); // m is 0-based, overflow rolls over
  const addDays = (d, n) => new Date(d.getTime() + n * DAY);
  const iso = (d) => d.toISOString().slice(0, 10);
  const fromIso = (s) => { const [y, m, d] = String(s).split("-").map(Number); return y && m && d ? D(y, m - 1, d) : null; };
  const lastDay = (y, m) => D(y, m + 1, 0).getUTCDate();
  const minusYear = (d) => D(d.getUTCFullYear() - 1, d.getUTCMonth(), Math.min(d.getUTCDate(), lastDay(d.getUTCFullYear() - 1, d.getUTCMonth())));
  const minDate = (a, b) => (a < b ? a : b);

  function utcToday() {
    const n = new Date();
    return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
  }

  function fmtRange(a, b) {
    const [ay, am, ad, by, bm, bd] = [a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate(), b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()];
    if (a.getTime() === b.getTime()) return `${MON[am]} ${ad}, ${ay}`;
    if (ay === by && am === bm) return `${MON[am]} ${ad} – ${bd}, ${by}`;
    if (ay === by) return `${MON[am]} ${ad} – ${MON[bm]} ${bd}, ${by}`;
    return `${MON[am]} ${ad}, ${ay} – ${MON[bm]} ${bd}, ${by}`;
  }

  // Ready-made periods, each with the comparison people usually pair with it.
  // Full days end yesterday; a period that starts today runs through today. Weeks start on Monday.
  // null = a gap between groups.
  function presets() {
    const T = utcToday(), Y = addDays(T, -1);
    const upTo = (start) => (Y < start ? T : Y);
    const ty = T.getUTCFullYear(), tm = T.getUTCMonth(), q0 = tm - (tm % 3);
    const ws = addDays(T, -((T.getUTCDay() + 6) % 7));
    const ms = D(ty, tm, 1), pms = D(ty, tm - 1, 1);
    const qs = D(ty, q0, 1), pqs = D(ty, q0 - 3, 1);
    const ys = D(ty, 0, 1);
    const sameDays = (start, end, prevStart, prevEnd) => [prevStart, minDate(addDays(prevStart, Math.round((end - start) / DAY)), prevEnd)];
    const wEnd = upTo(ws), mEnd = upTo(ms), qEnd = upTo(qs), yEnd = upTo(ys);
    return [
      ["yesterday", "Yesterday", [Y, Y], "Day before", [addDays(Y, -1), addDays(Y, -1)]],
      null,
      ["weekToDate", "This week so far", [ws, wEnd], "Same days last week", [addDays(ws, -7), addDays(wEnd, -7)]],
      ["lastWeek", "Last week", [addDays(ws, -7), addDays(ws, -1)], "Week before", [addDays(ws, -14), addDays(ws, -8)]],
      null,
      ["monthToDate", "This month so far", [ms, mEnd], "Same days last month", sameDays(ms, mEnd, pms, addDays(ms, -1))],
      ["lastMonth", "Last month", [pms, addDays(ms, -1)], "Month before", [D(ty, tm - 2, 1), addDays(pms, -1)]],
      null,
      ["quarterToDate", "This quarter so far", [qs, qEnd], "Same days last quarter", sameDays(qs, qEnd, pqs, addDays(qs, -1))],
      ["lastQuarter", "Last quarter", [pqs, addDays(qs, -1)], "Quarter before", [D(ty, q0 - 6, 1), addDays(pqs, -1)]],
      null,
      ["yearToDate", "This year so far", [ys, yEnd], "Same days last year", [D(ty - 1, 0, 1), minusYear(yEnd)]],
      ["lastYear", "Last year", [D(ty - 1, 0, 1), D(ty - 1, 11, 31)], "Year before", [D(ty - 2, 0, 1), D(ty - 2, 11, 31)]],
    ];
  }

  function presetMap() {
    const m = {};
    presets().forEach((r) => { if (r) m[r[0]] = r; });
    return m;
  }

  // view: {per: preset key | "custom", custom: [from, to], cmp: preset key | "prev" | "custom", cmpCustom, follow}
  // follow: the comparison follows the period until the person picks a comparison themselves.
  const DEFAULT_VIEW = { per: "lastMonth", custom: null, cmp: "lastMonth", cmpCustom: null, follow: true };

  function periodRange(v) {
    if (v.per === "custom" && v.custom) return v.custom;
    const m = presetMap();
    return (m[v.per] || m.lastMonth)[2];
  }

  function cmpRange(v) {
    if (v.cmp === "custom" && v.cmpCustom) return v.cmpCustom;
    const m = presetMap();
    if (m[v.cmp]) return m[v.cmp][4];
    const [a, b] = periodRange(v), n = Math.round((b - a) / DAY) + 1;
    return [addDays(a, -n), addDays(a, -1)];
  }

  const yoyRange = (v) => periodRange(v).map(minusYear);
  const followCmp = (v) => (v.per === "custom" ? "prev" : v.per);

  function saveView() {
    const v = state.view;
    store("jm.view", JSON.stringify({ ...v, custom: v.custom && v.custom.map(iso), cmpCustom: v.cmpCustom && v.cmpCustom.map(iso) }));
  }

  function loadView() {
    let v = null;
    try { v = JSON.parse(load("jm.view") || "null"); } catch (e) { v = null; }
    if (!v) return { ...DEFAULT_VIEW };
    const m = presetMap(), range = (r) => (Array.isArray(r) && r.length === 2 ? r.map(fromIso) : null);
    const out = { ...DEFAULT_VIEW, ...v, custom: range(v.custom), cmpCustom: range(v.cmpCustom) };
    if (!(m[out.per] || (out.per === "custom" && out.custom))) out.per = DEFAULT_VIEW.per;
    if (!(m[out.cmp] || out.cmp === "prev" || (out.cmp === "custom" && out.cmpCustom))) out.cmp = followCmp(out);
    return out;
  }

  // ── Auth ───────────────────────────────────────────────────────────────────

  function initAuth() {
    if (!window.JM_CONFIG || !JM_CONFIG.clientId || JM_CONFIG.clientId.startsWith("PASTE")) {
      message("Client ID is missing in config.js", "error");
      return;
    }
    state.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: JM_CONFIG.clientId,
      scope: SCOPE,
      callback: onToken,
      error_callback: (err) => message(`Sign-in was not completed: ${err.type || err.message || "unknown"}.`, "error"),
    });
    $("dataBtn").disabled = false;
    restoreToken();
  }

  function requestToken(prompt = "") {
    // prompt "" = consent screen only the first time; hint = skip the account chooser.
    state.tokenClient.requestAccessToken({ prompt, hint: prompt ? undefined : load("jm.email") || undefined });
  }

  function forgetToken() {
    state.token = null;
    state.tokenExp = 0;
    unstore("jm.token");
  }

  function expire() {
    forgetToken();
    state.expired = true;
    const text = state.lastData
      ? "Your Google session has ended (it lasts an hour). The numbers below are from your last load."
      : "Your Google session has ended (it lasts an hour). Reconnect to load the dashboard.";
    message(text, "warn", [{ label: "Reconnect", onClick: () => requestToken() }]);
    renderAll();
  }

  async function onToken(resp) {
    if (resp.error) {
      message(`Google returned an error: ${resp.error}.`, "error");
      return;
    }
    if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE_GA)) {
      message("Access to Google Analytics was not granted. Click Connect and allow it.", "error");
      return;
    }
    state.token = resp.access_token;
    state.tokenExp = Date.now() + (Number(resp.expires_in) - 60) * 1000;
    state.expired = false;
    clearMessage();
    // Keep the token for its lifetime (1 hour) so a reload doesn't ask to connect again.
    store("jm.token", JSON.stringify({ token: state.token, exp: state.tokenExp }));
    if (!load("jm.email")) rememberEmail();
    renderAll();
    await afterConnect();
  }

  async function rememberEmail() {
    try {
      const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${state.token}` } });
      const j = await r.json();
      if (j.email) store("jm.email", j.email);
    } catch (e) { /* not critical */ }
  }

  // Properties, then the dashboard for the last used property.
  async function afterConnect() {
    try {
      if (!state.properties.length) await loadProperties();
    } catch (e) {
      if (e.status === 401) { expire(); return; }
      message(`Could not load your Google Analytics properties: ${e.message}.`, "error");
      return;
    }
    if (!state.properties.length) {
      message("This Google account has no Google Analytics 4 properties. Use another account from the green button.", "error");
      renderAll();
      return;
    }
    const saved = load("jm.property");
    if (!state.propertyId && saved && state.properties.some((p) => p.id === saved)) state.propertyId = saved;
    renderAll();
    const run = state.pending;
    state.pending = null;
    if (run) run();
    else if (state.propertyId) build();
    else openMenu("data", $("dataBtn"));
  }

  function restoreToken() {
    let saved = null;
    try { saved = JSON.parse(load("jm.token") || "null"); } catch (e) { saved = null; }
    if (saved && saved.token && Date.now() < saved.exp) {
      state.token = saved.token;
      state.tokenExp = saved.exp;
      renderAll();
      afterConnect();
      return;
    }
    if (load("jm.email")) expire();
    else renderAll();
  }

  function tokenValid() {
    return state.token && Date.now() < state.tokenExp;
  }

  function disconnect() {
    const t = state.token;
    if (t && google.accounts.oauth2.revoke) google.accounts.oauth2.revoke(t, () => {});
    forgetToken();
    unstore("jm.email");
    state.expired = false;
    state.properties = [];
    state.lastData = null;
    $("frame").hidden = true;
    $("frame").removeAttribute("srcdoc");
    clearMessage();
    renderAll();
  }

  function useAnotherAccount() {
    unstore("jm.email");
    state.properties = [];
    state.propertyId = null;
    requestToken("select_account");
  }

  // ── Google APIs ────────────────────────────────────────────────────────────

  async function api(url, body) {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${state.token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (json.error && json.error.message) || res.statusText;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  async function loadProperties() {
    setLoading(true);
    try {
      const props = [];
      let pageToken = "";
      do {
        const q = new URLSearchParams({ pageSize: "200" });
        if (pageToken) q.set("pageToken", pageToken);
        const json = await api(`${ADMIN}/accountSummaries?${q}`);
        (json.accountSummaries || []).forEach((acc) => {
          (acc.propertySummaries || []).forEach((ps) => {
            props.push({ id: ps.property.split("/")[1], name: ps.displayName, account: acc.displayName });
          });
        });
        pageToken = json.nextPageToken || "";
      } while (pageToken);
      state.properties = props;
    } finally {
      setLoading(false);
    }
  }

  // ── Targets (per property, in this browser) ───────────────────────────────

  const TARGET_KEYS = [["s_pv", "Sessions → Product Views"], ["pv_atc", "Product Views → Add to Cart"], ["atc_chk", "Add to Cart → Checkout"], ["chk_pur", "Checkout → Purchase"]];

  function savedTargets(propertyId) {
    try { return JSON.parse(load(`jm.targets.${propertyId}`) || "null"); } catch (e) { return null; }
  }

  function withOverall(t) {
    return { ...t, overall: t.s_pv * t.pv_atc * t.atc_chk * t.chk_pur };
  }

  // Manual targets win; otherwise best month of the last 12.
  function currentTargets(ga4, propertyId) {
    const saved = savedTargets(propertyId);
    if (saved && saved.mode === "manual") return { targets: withOverall(saved.values), source: "manual" };
    const auto = autoTargets(ga4.monthly_events);
    return { targets: auto.targets, source: auto.targets ? `auto · best month of the last ${auto.months}` : null, months: auto.months };
  }

  function targetsLabel(info) {
    if (info.source === "manual") return "your own";
    if (info.targets) return `best month of the last ${info.months} months`;
    return "not set";
  }

  function fillTargetsPanel(info) {
    const t = info.targets;
    TARGET_KEYS.forEach(([k]) => { $(`t_${k}`).value = t ? (t[k] * 100).toFixed(1) : ""; });
    $("targetsNote").textContent = info.source === "manual"
      ? "Your own targets."
      : info.targets
        ? `Automatic: each step's best month over the last ${info.months} months. A theoretical peak, not a guaranteed goal.`
        : `Automatic targets need at least 3 months of history (found ${info.months || 0}). Enter your own.`;
  }

  function openTargetsPanel() {
    $("targets").hidden = false;
    $("targets").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function saveManualTargets() {
    const values = {};
    for (const [k] of TARGET_KEYS) {
      const v = parseFloat($(`t_${k}`).value);
      if (!(v > 0)) { $("targetsNote").textContent = "Fill in all four steps with numbers above 0."; return; }
      values[k] = v / 100;
    }
    store(`jm.targets.${state.lastPropertyId}`, JSON.stringify({ mode: "manual", values }));
    render();
  }

  function useAutoTargets() {
    unstore(`jm.targets.${state.lastPropertyId}`);
    render();
  }

  // ── Filters by segment ─────────────────────────────────────────────────────

  function gaFilters() {
    const f = {};
    FILTERS.forEach(([k]) => { if (state.filters[k].length) f[SEGMENT_DIMS[k]] = state.filters[k]; });
    return f;
  }

  function filtersLabel() {
    return FILTERS.filter(([k]) => state.filters[k].length).map(([k, name]) => `${name} = ${state.filters[k].join(", ")}`).join("; ");
  }

  // Values to choose from come from the last load where that segment was not filtered.
  function updateOptions(d) {
    FILTERS.forEach(([k]) => {
      if (state.filters[k].length || !d.segments || !d.segments[k]) return;
      const rows = d.segments[k].query_b_current.filter((r) => r.sessions > 0).sort((a, b) => b.sessions - a.sessions);
      state.options[k] = rows.slice(0, k === "landing_page" ? LP_OPTIONS : rows.length).map((r) => [r.segment, r.sessions]);
    });
  }

  function resetFilters() {
    FILTERS.forEach(([k]) => { state.filters[k] = []; state.options[k] = []; });
  }

  // ── Header rendering ───────────────────────────────────────────────────────

  function renderData() {
    const prop = property();
    let k = "Your data", v = "Connect Google Analytics", solid = true, chev = false;
    if (state.expired) {
      k = prop ? `${prop.name} · session ended` : "Session ended";
      v = "Reconnect Google Analytics";
    } else if (state.token) {
      k = "Your data · Google Analytics";
      chev = true;
      if (prop) { v = prop.name; solid = false; } else { v = state.properties.length ? "Choose your store" : "Loading…"; }
    }
    $("dataK").textContent = k;
    $("dataV").textContent = v;
    $("dataBtn").classList.toggle("jm-solid", solid);
    $("dataChev").hidden = !chev;
  }

  function renderPeriod() {
    const v = state.view;
    $("periodBtn").innerHTML = `<span class="jm-cal">${I().cal}</span><span class="jm-p1">${fmtRange(...periodRange(v))}</span><span class="jm-vs">vs</span><span class="jm-p2">${fmtRange(...cmpRange(v))}</span>${I().chev}`;
  }

  function renderChips() {
    const any = FILTERS.some(([k]) => state.filters[k].length);
    $("chips").innerHTML = FILTERS.map(([k, name]) => {
      const sel = state.filters[k];
      if (!sel.length) return `<button class="jm-chip" data-menu="f:${k}">${name}: <b>All</b>${I().chev}</button>`;
      const label = sel.length === 1 ? sel[0] : `${sel.length} selected`;
      return `<span class="jm-chip jm-on" data-menu="f:${k}" role="button" tabindex="0">${name}: <b>${esc(label)}</b><button class="jm-x" data-clear="${k}" aria-label="Remove ${name} filter">${I().x}</button></span>`;
    }).join("") + (any ? '<button class="jm-clear" data-act="clearFilters">Clear all</button>' : "");
  }

  function renderEmpty() {
    const show = !state.lastData;
    $("empty").hidden = !show;
    if (!show) return;
    let title = "See your GA4 funnel from traffic to revenue";
    let text = "Connect Google Analytics with the green button above and pick your store. Reports go from Google straight to this browser; we don't store your data.";
    if (state.expired) {
      title = "Reconnect to see your dashboard";
      text = "Your store and period are remembered. Reports go from Google straight to this browser; we don't store your data.";
    } else if (state.token) {
      if (state.loading) { title = "Loading your dashboard…"; text = "Reports go from Google straight to this browser."; }
      else if (!state.propertyId && state.properties.length) { title = "Choose your store"; text = "Pick the Google Analytics property of your store with the green button above."; }
    }
    $("emptyTitle").textContent = title;
    $("emptyText").textContent = text;
  }

  function renderAll() {
    renderData();
    const ready = !!(state.token && state.propertyId && !state.expired) || !!state.lastData;
    $("fbar").hidden = !ready;
    $("copyClaude").hidden = !state.lastData;
    $("moreBtn").hidden = !state.lastData;
    if (ready) { renderPeriod(); renderChips(); }
    renderEmpty();
  }

  // ── Menus ──────────────────────────────────────────────────────────────────

  let DR = null; // draft of the period panel: nothing changes until Apply

  function datesPanel() {
    const cell = (attr, k, on, name, range) => `<button class="jm-it${on ? " jm-sel" : ""}" ${attr}="${k}"${/week/i.test(name) ? ' title="Weeks run Monday to Sunday"' : ""}>${name}<span class="jm-md">${fmtRange(...range)}</span></button>`;
    const rows = presets().map((r) => (r ? `<div class="jm-pair">${cell("data-dper", r[0], DR.per === r[0], r[1], r[2])}${cell("data-dcmp", r[0], DR.cmp === r[0], r[3], r[4])}</div>` : '<div class="jm-gsep"></div>')).join("");
    const range = (kind, [a, b]) => `<div class="jm-range"><input type="date" id="jm-${kind}-from" value="${iso(a)}" aria-label="From"><span>–</span><input type="date" id="jm-${kind}-to" value="${iso(b)}" aria-label="To"></div>`;
    return `<div class="jm-pair"><div class="jm-ct">Period</div>
        <div class="jm-ct">Compared with<label class="jm-follow" title="When on, picking a period also picks its usual comparison"><input type="checkbox" id="jm-follow" ${DR.follow ? "checked" : ""}>Match period</label></div></div>
      <div class="jm-plist">${rows}</div>
      <div class="jm-pair">${range("per", periodRange(DR))}${range("cmp", cmpRange(DR))}</div>
      <div class="jm-foot"><div class="jm-sum"><span>Period <b>${fmtRange(...periodRange(DR))}</b></span><span>PoP <b>${fmtRange(...cmpRange(DR))}</b></span><span>YoY <b>${fmtRange(...yoyRange(DR))}</b></span></div>
        <button class="jm-btn" data-act="cancel">Cancel</button><button class="jm-btn jm-dark" data-act="applyDates">Apply</button></div>`;
  }

  function filterPanel(k) {
    const name = FILTERS.find((f) => f[0] === k)[1];
    const sel = state.filters[k];
    const opts = state.options[k].slice();
    sel.forEach((v) => { if (!opts.some((o) => o[0] === v)) opts.unshift([v, null]); });
    const list = opts.length
      ? opts.map(([v, n]) => `<label class="jm-it" data-val="${esc(String(v).toLowerCase())}"><input type="checkbox" value="${esc(v)}" ${sel.includes(v) ? "checked" : ""}><span>${esc(v)}</span><span class="jm-md">${n === null ? "" : n.toLocaleString("en-US")}</span></label>`).join("")
      : '<div class="jm-mh">Values appear after the dashboard loads.</div>';
    return `<div class="jm-mh">${name} · sessions in the period</div>
      ${k === "landing_page" ? '<input class="jm-search" id="jm-search" placeholder="Search pages" aria-label="Search pages">' : ""}
      <div class="jm-bulk"><button data-all="1">Select all</button><button data-all="0">Clear all</button></div>
      <div class="jm-opts">${list}</div>
      <div class="jm-acts"><button class="jm-btn jm-dark" data-apply="${k}">Apply</button><button class="jm-btn" data-clear="${k}">Clear</button></div>`;
  }

  function dataPanel() {
    const items = state.properties.map((p) => `<button class="jm-it${p.id === state.propertyId ? " jm-sel" : ""}" data-prop="${esc(p.id)}"><span>${esc(p.name)} <span class="jm-sub">${esc(p.account)}</span></span><span class="jm-md">${esc(p.id)}</span></button>`).join("");
    return `<div class="jm-mh">Google Analytics properties you can open</div>${items || '<div class="jm-mh">No properties yet.</div>'}<hr>
      <button class="jm-it" data-act="otherAccount">Use another Google account</button>
      <button class="jm-it jm-danger" data-act="disconnect">Disconnect</button>`;
  }

  function morePanel() {
    const mins = state.loadedAt ? Math.round((Date.now() - state.loadedAt) / 60000) : null;
    const ago = mins === null ? "" : mins < 1 ? "updated just now" : `updated ${mins} min ago`;
    return `<button class="jm-it" data-act="reload">Reload data<span class="jm-md">${ago}</span></button>
      <button class="jm-it" data-act="download">Download raw data (JSON)</button>`;
  }

  function closeMenu() {
    const m = $("jmMenu");
    m.hidden = true;
    m.innerHTML = "";
    delete m.dataset.kind;
  }

  function placeMenu(anchor) {
    const m = $("jmMenu"), r = anchor.getBoundingClientRect(), w = m.offsetWidth, vw = document.documentElement.clientWidth;
    m.style.left = `${Math.max(8, Math.min(r.left, vw - w - 8))}px`;
    m.style.top = `${r.bottom + 6}px`;
    m.style.maxHeight = `${Math.max(240, window.innerHeight - r.bottom - 14)}px`;
  }

  function openMenu(kind, anchor) {
    const m = $("jmMenu");
    if (!m.hidden && m.dataset.kind === kind) { closeMenu(); return; }
    if (kind === "dates") DR = { ...state.view };
    m.innerHTML = kind === "dates" ? datesPanel() : kind === "data" ? dataPanel() : kind === "more" ? morePanel() : filterPanel(kind.slice(2));
    m.classList.toggle("jm-dates", kind === "dates");
    m.dataset.kind = kind;
    m.hidden = false;
    state.menuAnchor = anchor;
    placeMenu(anchor);
  }

  function redrawDates() {
    const m = $("jmMenu"), list = m.querySelector(".jm-plist"), top = list ? list.scrollTop : 0;
    m.innerHTML = datesPanel();
    const l2 = m.querySelector(".jm-plist");
    if (l2) l2.scrollTop = top;
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  async function build() {
    if (!state.propertyId) { renderAll(); return; }
    if (!tokenValid()) { state.pending = build; expire(); return; }
    const prop = property();
    const propertyId = state.propertyId;
    store("jm.property", propertyId);
    const [start, end] = periodRange(state.view);
    const [ps, pe] = cmpRange(state.view);
    const periods = buildPeriods(start, end, ps, pe);
    const seq = ++state.seq;
    setLoading(true);
    if ($("msg").classList.contains("jm-error")) clearMessage();

    try {
      const plan = requestPlan(periods, gaFilters());
      const batches = chunk(plan, 5);
      const responses = await Promise.all(
        batches.map((b) => api(`${DATA}/properties/${propertyId}:batchRunReports`, { requests: b.map((x) => x.request) }))
      );
      if (seq !== state.seq) return; // a newer load started
      const rowsByKey = {};
      batches.forEach((b, i) => {
        const reports = responses[i].reports || [];
        b.forEach((x, j) => { rowsByKey[x.key] = reportRows(reports[j]); });
      });
      const d = toGa4Data(rowsByKey, periods, prop ? prop.name : "");
      d.filters_label = filtersLabel();
      updateOptions(d);
      state.lastData = d;
      state.lastPropertyId = propertyId;
      state.loadedAt = Date.now();
      if (!state.template) state.template = await (await fetch(`${(window.JM_CONFIG && JM_CONFIG.assetsBase) || ""}template.html${assetVersion()}`)).text();
      render();
    } catch (e) {
      if (seq !== state.seq) return;
      if (e.status === 401) { state.pending = build; expire(); return; }
      if (e.status === 403) {
        message(`This Google account has no access to ${prop ? prop.name : "this property"}.`, "error", [{ label: "Choose other data", onClick: () => openMenu("data", $("dataBtn")) }]);
      } else if (e.status === 429) {
        message("Google Analytics quota for this property is used up for now. Try again in an hour.", "error");
      } else {
        message(`Google Analytics returned an error: ${e.message}.`, "error", [{ label: "Try again", onClick: build }]);
      }
    } finally {
      if (seq === state.seq) setLoading(false);
      renderAll();
    }
  }

  // Re-render from data already in memory (no GA4 calls), e.g. after changing targets.
  function render() {
    const ga4 = state.lastData;
    if (!ga4 || !state.template) return;
    const p = processMap(ga4);
    Object.assign(p, buildVerdicts(p));
    const info = currentTargets(ga4, state.lastPropertyId);
    fillTargetsPanel(info);
    p.TGT_SRC = targetsLabel(info);
    if (info.targets) {
      Object.assign(p, processTree(ga4, info.targets));
    } else {
      p.TREE_EMPTY_STATE = '<div class="empty-state-bar"><span>Set funnel targets to build the Driver Tree: click “Change” next to Targets above.</span></div>';
      p.TV_DSP = "none";
    }
    Object.assign(p, processSegments(ga4));
    const frame = $("frame");
    const tab = frame.contentWindow && frame.contentDocument && frame.contentDocument.querySelector(".vt-btn.active");
    const activeTab = tab ? tab.dataset.tab : null;
    frame.onload = () => {
      if (activeTab && activeTab !== "map" && frame.contentWindow.switchTab) frame.contentWindow.switchTab(activeTab);
    };
    frame.srcdoc = fillTemplate(state.template, p);
    frame.hidden = false;
    state.lastPlaceholders = p;
    state.lastTargets = info;
    renderAll();
  }

  // ── Copy for Claude: our analysis brief + this dashboard's data ───────────

  async function copyForClaude() {
    if (!state.lastData || !state.lastPlaceholders) return;
    try {
      if (!state.prompt) {
        const base = (window.JM_CONFIG && JM_CONFIG.assetsBase) || "";
        state.prompt = await (await fetch(`${base}claude_prompt.md${assetVersion()}`)).text();
      }
      const text = `${state.prompt.trim()}\n\n${buildSummary(state.lastData, state.lastPlaceholders, state.lastTargets)}\n`;
      await copyText(text);
      message(`Copied the analysis brief and this dashboard's data (${text.length.toLocaleString("en-US")} characters). Paste them into a new Claude chat.`, "ok", [{ label: "Open Claude →", href: "https://claude.ai/new" }]);
    } catch (e) {
      message(`Could not copy: ${e.message}.`, "error");
    }
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); return; } catch (e) { /* fall back below */ }
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (!ok) throw new Error("the browser blocked clipboard access");
  }

  function downloadData() {
    if (!state.lastData) return;
    const blob = new Blob([JSON.stringify(state.lastData, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ga4_data_${state.lastPropertyId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  function onClick(e) {
    const menu = $("jmMenu");
    const inMenu = menu.contains(e.target);
    const t = e.target.closest("button, a, [data-menu]");
    if (!t || !$("jm-app").contains(t)) { if (!inMenu) closeMenu(); return; }
    if (inMenu && !e.target.closest("button")) return; // checkboxes, inputs, labels stay in the menu

    if (t.dataset.all) { menu.querySelectorAll(".jm-opts label:not([hidden]) input[type=checkbox]").forEach((i) => { i.checked = t.dataset.all === "1"; }); return; }
    if (t.dataset.clear) { e.stopPropagation(); state.filters[t.dataset.clear] = []; closeMenu(); build(); return; }
    if (t.id === "dataBtn") {
      if (state.expired || !state.token) { closeMenu(); requestToken(); return; }
      openMenu("data", t); return;
    }
    if (t.dataset.menu) { openMenu(t.dataset.menu, t); return; }
    if (t.dataset.dper) { DR.per = t.dataset.dper; if (DR.follow) DR.cmp = followCmp(DR); redrawDates(); return; }
    if (t.dataset.dcmp) { DR.cmp = t.dataset.dcmp; DR.follow = false; redrawDates(); return; }
    if (t.dataset.apply) {
      state.filters[t.dataset.apply] = [...menu.querySelectorAll(".jm-opts input[type=checkbox]:checked")].map((i) => i.value);
      closeMenu(); build(); return;
    }
    if (t.dataset.prop) {
      closeMenu();
      if (t.dataset.prop !== state.propertyId) { state.propertyId = t.dataset.prop; resetFilters(); state.lastData = null; build(); }
      return;
    }
    const act = t.dataset.act;
    if (act === "applyDates") { state.view = { ...DR }; saveView(); closeMenu(); build(); return; }
    if (act === "cancel") { closeMenu(); return; }
    if (act === "reload") { closeMenu(); build(); return; }
    if (act === "download") { closeMenu(); downloadData(); return; }
    if (act === "otherAccount") { closeMenu(); useAnotherAccount(); return; }
    if (act === "disconnect") { closeMenu(); disconnect(); return; }
    if (act === "clearFilters") { resetFiltersOnly(); build(); return; }
  }

  function resetFiltersOnly() {
    FILTERS.forEach(([k]) => { state.filters[k] = []; });
  }

  function onChange(e) {
    const id = e.target.id;
    if (id === "jm-follow" && DR) { DR.follow = e.target.checked; if (DR.follow) DR.cmp = followCmp(DR); redrawDates(); return; }
    const m = /^jm-(per|cmp)-(from|to)$/.exec(id);
    if (!m || !DR) return;
    const k = m[1], a = fromIso($(`jm-${k}-from`).value), b = fromIso($(`jm-${k}-to`).value);
    if (!a || !b || a > b) return;
    if (k === "per") { DR.per = "custom"; DR.custom = [a, b]; if (DR.follow) DR.cmp = "prev"; }
    else { DR.cmp = "custom"; DR.cmpCustom = [a, b]; DR.follow = false; }
    redrawDates();
  }

  function onInput(e) {
    if (e.target.id !== "jm-search") return;
    const q = e.target.value.trim().toLowerCase();
    $("jmMenu").querySelectorAll(".jm-opts label").forEach((l) => { l.hidden = !!q && !l.dataset.val.includes(q); });
  }

  // ── Wire up ────────────────────────────────────────────────────────────────

  function start() {
    if (window.JMShell) JMShell.mount();
    state.view = loadView();
    document.addEventListener("click", onClick);
    document.addEventListener("change", onChange);
    document.addEventListener("input", onInput);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu();
      if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("#jm-app span.jm-chip[data-menu]")) { e.preventDefault(); openMenu(e.target.dataset.menu, e.target); }
    });
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", (e) => { if (!$("jmMenu").contains(e.target)) closeMenu(); }, true);
    window.addEventListener("message", (e) => {
      if (e.source === $("frame").contentWindow && e.data && e.data.jm === "targets") openTargetsPanel();
    });
    $("copyClaude").addEventListener("click", copyForClaude);
    $("targetsSave").addEventListener("click", saveManualTargets);
    $("targetsAuto").addEventListener("click", useAutoTargets);
    $("targetsClose").addEventListener("click", () => { $("targets").hidden = true; });
    renderAll();
    // Fit the iframe to its content (tabs change the height).
    setInterval(() => {
      const doc = $("frame").contentDocument;
      if (!$("frame").hidden && doc && doc.body) $("frame").style.height = `${doc.documentElement.scrollHeight + 20}px`;
    }, 500);
    const wait = setInterval(() => {
      if (window.google && google.accounts && google.accounts.oauth2) {
        clearInterval(wait);
        initAuth();
      }
    }, 100);
  }

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);

  // Debug handle (no globals besides JMCore, JMShell, JMApp).
  window.JMApp = { state, render, build, presets, saveManualTargets, useAutoTargets };
})();
