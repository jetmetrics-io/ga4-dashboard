// JetMetrics GA4 dashboard — prototype app shell.
// Google sign-in in the browser (GIS token model), GA4 Admin API for the property list,
// GA4 Data API batchRunReports for data. Nothing leaves the browser except calls to Google.

(function () {
  "use strict";

  const { buildPeriods, requestPlan, chunk, reportRows, toGa4Data, processMap, buildVerdicts, autoTargets, processTree, processSegments, buildSummary } = window.JMCore;
  const fillTemplate = window.JMCore.fillTemplate;

  const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
  const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
  const DATA = "https://analyticsdata.googleapis.com/v1beta";

  const state = { token: null, tokenExp: 0, tokenClient: null, properties: [], template: null, lastData: null };
  const $ = (id) => document.getElementById(id);

  function status(text, kind = "", link = null) {
    const el = $("status");
    el.textContent = text;
    el.className = `status ${kind}`;
    if (link) {
      const a = document.createElement("a");
      a.href = link.href;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = link.text;
      el.appendChild(a);
    }
  }

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

  // ── Auth ───────────────────────────────────────────────────────────────────

  function initAuth() {
    if (!window.JM_CONFIG || !JM_CONFIG.clientId || JM_CONFIG.clientId.startsWith("PASTE")) {
      status("Client ID is missing in config.js", "error");
      return;
    }
    state.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: JM_CONFIG.clientId,
      scope: SCOPE,
      callback: onToken,
      error_callback: (err) => status(`Sign-in was not completed: ${err.type || err.message || "unknown"}`, "error"),
    });
    $("connect").disabled = false;
  }

  function requestToken() {
    state.tokenClient.requestAccessToken({ prompt: state.token ? "" : "consent" });
  }

  async function onToken(resp) {
    if (resp.error) {
      status(`Google returned an error: ${resp.error}`, "error");
      return;
    }
    state.token = resp.access_token;
    state.tokenExp = Date.now() + (Number(resp.expires_in) - 60) * 1000;
    $("connect").textContent = "Connected";
    $("connect").classList.add("connected");
    if (!state.properties.length) await loadProperties();
    if (state.pending) {
      const run = state.pending;
      state.pending = null;
      run();
    }
  }

  function tokenValid() {
    return state.token && Date.now() < state.tokenExp;
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
    status("Loading your GA4 properties…");
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
    const sel = $("property");
    sel.innerHTML = "";
    if (!props.length) {
      status("This Google account has no GA4 properties.", "error");
      return;
    }
    props.forEach((p) => {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = `${p.name} — ${p.account} (${p.id})`;
      sel.appendChild(o);
    });
    const saved = load("jm.property");
    if (saved && props.some((p) => p.id === saved)) sel.value = saved;
    sel.disabled = false;
    $("period").disabled = false;
    $("refresh").disabled = false;
    status(`${props.length} properties found. Pick one and press Refresh.`);
  }

  // ── Periods ────────────────────────────────────────────────────────────────

  function utcToday() {
    const n = new Date();
    return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
  }

  function selectedRange() {
    const today = utcToday();
    const yesterday = new Date(today.getTime() - 86400000);
    switch ($("period").value) {
      case "last28":
        return [new Date(yesterday.getTime() - 27 * 86400000), yesterday];
      case "lastMonth": {
        const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
        const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
        return [start, end];
      }
      case "thisMonth":
      default: {
        const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
        return [start, yesterday < start ? today : yesterday];
      }
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

  function fillTargetsPanel(info) {
    const t = info.targets;
    TARGET_KEYS.forEach(([k]) => { $(`t_${k}`).value = t ? (t[k] * 100).toFixed(1) : ""; });
    $("targetsNote").textContent = info.source === "manual"
      ? "Your own targets."
      : info.targets
        ? `Automatic: each step's best month over the last ${info.months} months. A theoretical peak, not a guaranteed goal.`
        : `Automatic targets need at least 3 months of history (found ${info.months || 0}). Enter your own.`;
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
    try { localStorage.removeItem(`jm.targets.${state.lastPropertyId}`); } catch (e) { /* ignore */ }
    render();
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  async function build() {
    if (!tokenValid()) {
      state.pending = build;
      requestToken();
      return;
    }
    const propertyId = $("property").value;
    const prop = state.properties.find((p) => p.id === propertyId);
    store("jm.property", propertyId);
    store("jm.period", $("period").value);

    const [start, end] = selectedRange();
    const periods = buildPeriods(start, end);
    const t0 = performance.now();
    status(`Loading GA4 data for ${periods.label}…`);
    $("refresh").disabled = true;

    try {
      const plan = requestPlan(periods);
      const batches = chunk(plan, 5);
      const responses = await Promise.all(
        batches.map((b) => api(`${DATA}/properties/${propertyId}:batchRunReports`, { requests: b.map((x) => x.request) }))
      );
      const rowsByKey = {};
      batches.forEach((b, i) => {
        const reports = responses[i].reports || [];
        b.forEach((x, j) => { rowsByKey[x.key] = reportRows(reports[j]); });
      });
      state.lastData = toGa4Data(rowsByKey, periods, prop ? prop.name : "");
      state.lastPropertyId = propertyId;
      if (!state.template) state.template = await (await fetch(`${(window.JM_CONFIG && JM_CONFIG.assetsBase) || ""}template.html${assetVersion()}`)).text();
      render();

      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      const yoyNote = state.lastData.yoy_available ? "" : " No data for the same period last year, YoY is hidden.";
      status(`Done in ${secs}s · ${batches.length} requests to GA4 · ${periods.label}.${yoyNote}`, "ok");
    } catch (e) {
      if (e.status === 401) {
        state.token = null;
        state.pending = build;
        requestToken();
        return;
      }
      const hint = e.status === 403 ? " Check that this Google account has access to the property." : e.status === 429 ? " GA4 quota is exhausted for now, try again later." : "";
      status(`GA4 error ${e.status || ""}: ${e.message}.${hint}`, "error");
    } finally {
      $("refresh").disabled = false;
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
    $("targetsBtn").disabled = false;
    if (info.targets) {
      Object.assign(p, processTree(ga4, info.targets));
    } else {
      p.TREE_EMPTY_STATE = '<div class="empty-state-bar"><span>Set funnel targets with the “Targets” button above to build the Driver Tree</span></div>';
    }
    Object.assign(p, processSegments(ga4));
    const frame = $("frame");
    const tab = frame.contentWindow && frame.contentDocument && frame.contentDocument.querySelector(".tab-btn.active");
    const activeTab = tab ? tab.dataset.tab : null;
    frame.onload = () => {
      if (activeTab && activeTab !== "map" && frame.contentWindow.switchTab) frame.contentWindow.switchTab(activeTab);
    };
    frame.srcdoc = fillTemplate(state.template, p);
    state.lastPlaceholders = p;
    state.lastTargets = info;
    $("download").disabled = false;
    $("copyClaude").disabled = false;
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
      status(`Copied: analysis brief + data, ${text.length.toLocaleString("en-US")} characters. Paste it into a new Claude chat.`, "ok", { href: "https://claude.ai/new", text: "Open Claude →" });
    } catch (e) {
      status(`Could not copy: ${e.message}`, "error");
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
    a.download = `ga4_data_${$("property").value}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ── Wire up ────────────────────────────────────────────────────────────────

  function start() {
    if (window.JMShell) JMShell.mount();
    const savedPeriod = load("jm.period");
    if (savedPeriod) $("period").value = savedPeriod;
    $("connect").addEventListener("click", requestToken);
    $("refresh").addEventListener("click", build);
    $("download").addEventListener("click", downloadData);
    $("targetsBtn").addEventListener("click", () => { $("targets").hidden = !$("targets").hidden; });
    $("targetsSave").addEventListener("click", saveManualTargets);
    $("targetsAuto").addEventListener("click", useAutoTargets);
    $("copyClaude").addEventListener("click", copyForClaude);
    // Fit the iframe to its content (tabs change the height).
    setInterval(() => {
      const doc = $("frame").contentDocument;
      if ($("frame").srcdoc && doc && doc.body) $("frame").style.height = `${doc.documentElement.scrollHeight + 20}px`;
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
  window.JMApp = { state, render, saveManualTargets, useAutoTargets };
})();
