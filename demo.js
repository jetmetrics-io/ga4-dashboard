// JetMetrics Funnel Dashboard: a demo store with sample data. It answers the dashboard's GA4 requests
// (accountSummaries, batchRunReports) in the browser, without Google, so any period, comparison and filter works.
//
// The store: a fashion DTC brand, ~400k sessions a month, data from Jul 1, 2024 to yesterday, with yearly
// seasonality (Black Friday, December), weekdays and steady growth. Two stories are built in, always relative
// to today:
//   - mobile Checkout → Purchase dropped in the last 6 weeks (a payment issue);
//   - Paid Social grew over the last 10 weeks, with weak traffic that rarely adds to cart.
// Deterministic: the same day always gives the same numbers.
(function (global) {
  const DAY = 86400000;
  const START = Date.UTC(2024, 6, 1);
  const FUNNEL = ["session_start", "view_item", "add_to_cart", "begin_checkout", "purchase"];

  // ── Deterministic noise ──────────────────────────────────────────────────────
  function rnd(...keys) {
    let h = 2166136261;
    for (const k of keys) {
      const s = String(k);
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      h ^= 124; h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 1000003) / 1000003;
  }
  const nz = (amp, ...keys) => 1 + amp * (rnd(...keys) * 2 - 1);

  // ── The store ────────────────────────────────────────────────────────────────
  // [name, share, device mix (mobile, desktop, tablet), new share, rate multipliers (view, atc, chk, pur), AOV multiplier]
  const CHANNELS = [
    ["Organic Search", 0.26, [0.62, 0.34, 0.04], 0.72, [1.04, 1.0, 1.0, 1.0], 1.0],
    ["Paid Search", 0.17, [0.64, 0.32, 0.04], 0.7, [1.06, 1.12, 1.02, 1.0], 0.98],
    ["Paid Social", 0.15, [0.86, 0.12, 0.02], 0.86, [0.96, 0.6, 0.9, 0.95], 0.9],
    ["Organic Social", 0.07, [0.84, 0.14, 0.02], 0.76, [0.92, 0.82, 0.95, 0.97], 0.93],
    ["Direct", 0.17, [0.6, 0.36, 0.04], 0.45, [1.0, 1.15, 1.05, 1.05], 1.05],
    ["Email", 0.09, [0.66, 0.31, 0.03], 0.22, [1.08, 1.35, 1.08, 1.08], 1.08],
    ["Referral", 0.05, [0.58, 0.38, 0.04], 0.68, [1.0, 1.05, 1.0, 1.0], 1.02],
    ["Unassigned", 0.04, [0.65, 0.31, 0.04], 0.6, [0.75, 0.8, 0.9, 0.95], 1.0],
  ];
  const DEVICES = [["mobile", [0.98, 0.95, 0.95, 0.94]], ["desktop", [1.04, 1.12, 1.08, 1.08]], ["tablet", [1.0, 1.0, 1.0, 1.0]]];
  const USERS = [["new", [1.0, 1.0, 1.0, 1.0], 1.0], ["returning", [1.03, 1.3, 1.08, 1.12], 1.08], ["(not set)", [0.6, 0.5, 0.8, 0.9], 1.0]];
  const BASE = { atc: 0.115, chk: 0.5, pur: 0.64 };
  const AOV = 92;

  // Landing pages: [path, type]. Types set the view rate (sessions that see a product) and the add-to-cart lift.
  const TYPES = {
    home: { view: 0.4, atc: 1.0, chk: 1.0 }, collection: { view: 0.64, atc: 1.0, chk: 1.0 }, product: { view: 0.95, atc: 1.12, chk: 1.0 },
    sale: { view: 0.72, atc: 1.25, chk: 1.02 }, blog: { view: 0.24, atc: 0.8, chk: 1.0 }, info: { view: 0.3, atc: 0.9, chk: 1.0 },
    cart: { view: 0.5, atc: 1.6, chk: 1.3 }, notset: { view: 0.35, atc: 0.8, chk: 0.9 },
  };
  const PAGES = [
    ["/", "home"], ["/collections/new-arrivals", "collection"], ["/collections/dresses", "collection"],
    ["/collections/tops-and-shirts", "collection"], ["/collections/knitwear", "collection"], ["/collections/outerwear", "collection"],
    ["/collections/trousers", "collection"], ["/collections/basics", "collection"], ["/collections/accessories", "collection"],
    ["/collections/sale", "sale"],
    ["/products/linen-shirt-dress", "product"], ["/products/wide-leg-trousers", "product"], ["/products/cashmere-crew-sweater", "product"],
    ["/products/oversized-wool-blazer", "product"], ["/products/leather-ankle-boots", "product"], ["/products/silk-slip-skirt", "product"],
    ["/products/organic-cotton-tee", "product"], ["/products/quilted-liner-jacket", "product"], ["/products/ribbed-knit-midi-dress", "product"],
    ["/products/straight-leg-jeans", "product"], ["/products/merino-cardigan", "product"], ["/products/canvas-tote-bag", "product"],
    ["/blogs/journal/fall-capsule-wardrobe", "blog"], ["/blogs/journal/how-to-style-wide-leg-trousers", "blog"], ["/blogs/journal/linen-care-guide", "blog"],
    ["/pages/size-guide", "info"], ["/pages/shipping-and-returns", "info"], ["/pages/about", "info"], ["/account/login", "info"],
    ["/cart", "cart"], ["(not set)", "notset"],
  ];
  // Share of each page type by channel (same order as CHANNELS)
  const TYPE_MIX = [
    { home: 0.14, collection: 0.22, product: 0.38, sale: 0.03, blog: 0.17, info: 0.05, cart: 0, notset: 0.01 },
    { home: 0.1, collection: 0.3, product: 0.52, sale: 0.05, blog: 0, info: 0.02, cart: 0, notset: 0.01 },
    { home: 0.04, collection: 0.3, product: 0.58, sale: 0.06, blog: 0.01, info: 0, cart: 0, notset: 0.01 },
    { home: 0.1, collection: 0.2, product: 0.38, sale: 0.04, blog: 0.26, info: 0.01, cart: 0, notset: 0.01 },
    { home: 0.52, collection: 0.12, product: 0.14, sale: 0.04, blog: 0.02, info: 0.08, cart: 0.06, notset: 0.02 },
    { home: 0.12, collection: 0.3, product: 0.22, sale: 0.34, blog: 0.01, info: 0.01, cart: 0, notset: 0 },
    { home: 0.25, collection: 0.15, product: 0.3, sale: 0.02, blog: 0.18, info: 0.1, cart: 0, notset: 0 },
    { home: 0.4, collection: 0.1, product: 0.15, sale: 0.02, blog: 0.03, info: 0.05, cart: 0.05, notset: 0.2 },
  ];
  // Page share inside a channel: type share split between the pages of that type, the first pages more popular
  const PAGE_SHARE = CHANNELS.map((_, ci) => {
    const w = PAGES.map(([path, type], i) => {
      const sameType = PAGES.filter((p) => p[1] === type);
      const rank = sameType.findIndex((p) => p[0] === path);
      const zipf = 1 / (rank + 1.6);
      const norm = sameType.reduce((t, _p, r) => t + 1 / (r + 1.6), 0);
      return (TYPE_MIX[ci][type] || 0) * (zipf / norm) * nz(0.25, "page", ci, i);
    });
    const sum = w.reduce((a, b) => a + b, 0);
    return w.map((x) => x / sum);
  });

  // ── Time ─────────────────────────────────────────────────────────────────────
  const yesterday = () => { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) - DAY; };
  const MONTH = [0.86, 0.84, 0.95, 0.97, 1.0, 0.92, 0.9, 0.94, 1.0, 1.03, 1.16, 1.2];
  const WEEKDAY = [1.06, 1.04, 1.0, 0.99, 0.98, 0.94, 0.99]; // Sun..Sat

  function blackFriday(y) {
    const nov1 = new Date(Date.UTC(y, 10, 1)).getUTCDay();
    return Date.UTC(y, 10, 1 + ((5 - nov1 + 7) % 7) + 21); // 4th Friday of November
  }

  function sessionsOn(t) {
    const d = new Date(t), y = d.getUTCFullYear();
    const years = (t - START) / (365 * DAY);
    const bf = blackFriday(y);
    const peak = t >= bf - DAY && t <= bf + 3 * DAY ? 1.7 : 1;
    return 9400 * (1 + 0.17 * years) * MONTH[d.getUTCMonth()] * WEEKDAY[d.getUTCDay()] * peak * nz(0.06, "s", t);
  }

  // Paid Social share grows over the last 10 weeks (story 2)
  function channelShares(t) {
    const p = Math.min(1, Math.max(0, 1 - (yesterday() - t) / (70 * DAY)));
    const raw = CHANNELS.map((c, i) => c[1] * (i === 2 ? 1 + 0.9 * p : 1) * nz(0.05, "c", t, i));
    const sum = raw.reduce((a, b) => a + b, 0);
    return raw.map((x) => x / sum);
  }

  // Mobile Checkout → Purchase drops over 3 days, 6 weeks ago (story 1)
  function mobileDrop(t, vi) {
    if (vi !== 0) return 1;
    const days = (yesterday() - t) / DAY;
    if (days > 44) return 1;
    if (days > 41) return 1 - 0.3 * ((44 - days) / 3);
    return 0.7;
  }

  // Per day: sessions, channel shares, month (computed once a day)
  const dayCtx = new Map();
  function day(t) {
    if (!dayCtx.has(t)) dayCtx.set(t, { t, S: sessionsOn(t), shares: channelShares(t), month: new Date(t).getUTCMonth() });
    return dayCtx.get(t);
  }

  // Per day × channel × device × user type: the noise on each funnel rate and AOV (the same for every landing page)
  const noiseCache = new Map();
  function noise(t, ci, vi, ui) {
    const key = `${t}|${ci}|${vi}|${ui}`;
    if (!noiseCache.has(key)) {
      const k = (s) => nz(0.04, s, t, ci, vi, ui);
      noiseCache.set(key, { v: k("v"), a: k("a"), c: k("c"), p: k("p"), o: k("o") });
    }
    return noiseCache.get(key);
  }

  // ── One cell: day × channel × device × user type × landing page ──────────────
  function cell(dc, ci, vi, ui, li, n) {
    const t = dc.t;
    const [, , dev, newShare, cm, aovM] = CHANNELS[ci];
    const [, dm] = DEVICES[vi];
    const [, um, aovU] = USERS[ui];
    const userShare = ui === 2 ? 0.01 : (ui === 0 ? newShare : 1 - newShare) * 0.99;
    const sess = dc.S * dc.shares[ci] * dev[vi] * userShare * PAGE_SHARE[ci][li];
    const type = TYPES[PAGES[li][1]];
    const viewR = Math.min(0.985, type.view * cm[0] * dm[0] * um[0] * n.v);
    const atcR = Math.min(0.9, BASE.atc * type.atc * cm[1] * dm[1] * um[1] * n.a);
    const chkR = Math.min(0.95, BASE.chk * type.chk * cm[2] * dm[2] * um[2] * n.c);
    const purR = Math.min(0.97, BASE.pur * cm[3] * dm[3] * um[3] * mobileDrop(t, vi) * n.p);
    const view = sess * viewR, atc = view * atcR, chk = atc * chkR, pur = chk * purR;
    const tx = pur * 1.03;
    const aov = AOV * aovM * aovU * (dc.month === 10 ? 0.9 : 1) * n.o;
    const purchasers = pur * 0.98;
    return {
      sessions: sess, session_start: sess * 0.995, view_item: view, add_to_cart: atc, begin_checkout: chk, purchase: pur,
      session_start_count: sess * 0.995, view_item_count: view * 2.9, add_to_cart_count: atc * 1.35, begin_checkout_count: chk * 1.1, purchase_count: tx,
      transactions: tx, totalRevenue: tx * aov, totalPurchasers: purchasers,
      firstTimePurchasers: purchasers * (ui === 0 ? 0.93 : ui === 1 ? 0.12 : 0.6), totalUsers: sess * 0.8,
    };
  }

  // Day totals per channel × device × user type (landing pages summed), kept for reuse
  const dayCache = new Map();
  function dayCells(t) {
    if (dayCache.has(t)) return dayCache.get(t);
    const dc = day(t), out = [];
    for (let ci = 0; ci < CHANNELS.length; ci++) for (let vi = 0; vi < DEVICES.length; vi++) for (let ui = 0; ui < USERS.length; ui++) {
      const sum = {}, n = noise(t, ci, vi, ui);
      for (let li = 0; li < PAGES.length; li++) {
        const c = cell(dc, ci, vi, ui, li, n);
        for (const m in c) sum[m] = (sum[m] || 0) + c[m];
      }
      out.push({ ci, vi, ui, m: sum });
    }
    dayCache.set(t, out);
    return out;
  }

  // ── GA4 request → report ─────────────────────────────────────────────────────
  // inList filters (andGroup or single) → {fieldName: Set of values}
  function constraints(f, out = {}) {
    if (!f) return out;
    if (f.andGroup) f.andGroup.expressions.forEach((x) => constraints(x, out));
    else if (f.filter && f.filter.inListFilter) {
      const vals = new Set(f.filter.inListFilter.values);
      const prev = out[f.filter.fieldName];
      out[f.filter.fieldName] = prev ? new Set([...prev].filter((v) => vals.has(v))) : vals;
    }
    return out;
  }

  const pad = (n) => String(n).padStart(2, "0");
  function timeValues(t) {
    const d = new Date(t), y = d.getUTCFullYear();
    const doy = Math.round((t - Date.UTC(y, 0, 1)) / DAY);
    const week = Math.floor((doy + new Date(Date.UTC(y, 0, 1)).getUTCDay()) / 7) + 1; // GA4 weeks start on Sunday
    return { yearWeek: `${y}${pad(week)}`, yearMonth: `${y}${pad(d.getUTCMonth() + 1)}` };
  }

  function runReport(req) {
    const dims = (req.dimensions || []).map((d) => d.name);
    const mets = req.metrics.map((m) => m.name);
    const ranges = req.dateRanges || [];
    const outDims = ranges.length > 1 ? dims.concat(["dateRange"]) : dims;
    const cons = constraints(req.dimensionFilter);
    const ok = (field, v) => !cons[field] || cons[field].has(v);
    const byPage = dims.includes("landingPage") || !!cons.landingPage;
    const events = dims.includes("eventName") ? FUNNEL.filter((e) => ok("eventName", e)) : null;
    const pages = byPage ? PAGES.map((p, i) => i).filter((i) => ok("landingPage", PAGES[i][0])) : null;
    const acc = new Map();
    const add = (vals, metrics) => {
      const key = outDims.map((d) => vals[d]).join("\u0001");
      let row = acc.get(key);
      if (!row) { row = { vals: outDims.map((d) => vals[d]), m: mets.map(() => 0) }; acc.set(key, row); }
      mets.forEach((name, i) => { row.m[i] += metrics[name] || 0; });
    };
    const emit = (vals, c) => {
      if (!events) { add(vals, c); return; }
      events.forEach((e) => { vals.eventName = e; add(vals, { sessions: c[e], eventCount: c[`${e}_count`] }); });
    };
    const last = yesterday();
    ranges.forEach((r, ri) => {
      const from = Math.max(START, Date.parse(`${r.startDate}T00:00:00Z`));
      const to = Math.min(last, Date.parse(`${r.endDate}T00:00:00Z`));
      for (let t = from; t <= to; t += DAY) {
        const tv = timeValues(t);
        const base = { yearWeek: tv.yearWeek, yearMonth: tv.yearMonth, dateRange: r.name || `date_range_${ri}` };
        const dc = day(t);
        for (const { ci, vi, ui, m } of dayCells(t)) {
          const vals = { ...base, sessionDefaultChannelGrouping: CHANNELS[ci][0], deviceCategory: DEVICES[vi][0], newVsReturning: USERS[ui][0] };
          if (!ok("sessionDefaultChannelGrouping", vals.sessionDefaultChannelGrouping) || !ok("deviceCategory", vals.deviceCategory) || !ok("newVsReturning", vals.newVsReturning)) continue;
          if (!byPage) { emit(vals, m); continue; }
          const n = noise(t, ci, vi, ui);
          for (const li of pages) { vals.landingPage = PAGES[li][0]; emit(vals, cell(dc, ci, vi, ui, li, n)); }
        }
      }
    });
    let rows = [...acc.values()].map((r) => ({
      dimensionValues: r.vals.map((value) => ({ value: String(value) })),
      metricValues: r.m.map((v, i) => ({ value: String(mets[i] === "totalRevenue" ? Math.round(v * 100) / 100 : Math.round(v)) })),
    }));
    const order = (req.orderBys || [])[0];
    if (order && order.metric) {
      const i = mets.indexOf(order.metric.metricName);
      if (i >= 0) rows.sort((a, b) => (Number(b.metricValues[i].value) - Number(a.metricValues[i].value)) * (order.desc ? 1 : -1));
    }
    const rowCount = rows.length;
    if (req.limit) rows = rows.slice(0, Number(req.limit));
    return { dimensionHeaders: outDims.map((name) => ({ name })), metricHeaders: mets.map((name) => ({ name })), rows, rowCount, metadata: { currencyCode: "USD" } };
  }

  // The same answers the GA4 Admin and Data APIs give, after a short pause so loading looks like loading
  async function answer(url, body) {
    await new Promise((r) => setTimeout(r, 250));
    if (url.includes("accountSummaries")) {
      return { accountSummaries: [{ displayName: "Sample data", propertySummaries: [{ property: "properties/demo", displayName: "Demo store" }] }] };
    }
    if (url.includes(":batchRunReports")) return { reports: body.requests.map(runReport) };
    throw Object.assign(new Error("Not available in the demo"), { status: 400 });
  }

  global.JMDemo = { answer, runReport, property: { id: "demo", name: "Demo store", account: "Sample data" } };
})(typeof window !== "undefined" ? window : globalThis);
