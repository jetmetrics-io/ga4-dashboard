// JetMetrics GA4 Funnel Dashboard — core.
// 1) GA4 query plan (batchRunReports), 2) responses → ga4_data,
// 3) process(): port of processor.py process() — Map tab placeholders,
// 4) fillTemplate(): placeholders → final HTML.
// Data source is swappable: anything that produces ga4_data feeds process().

(function (global) {
  "use strict";

  const FUNNEL_EVENTS = ["session_start", "view_item", "add_to_cart", "begin_checkout", "purchase"];
  const AGG_METRICS = ["sessions", "totalRevenue", "transactions", "firstTimePurchasers", "totalPurchasers", "totalUsers"];

  // ── Periods ────────────────────────────────────────────────────────────────

  function isoDate(d) {
    return d.toISOString().slice(0, 10);
  }

  function addDays(d, n) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    x.setUTCDate(x.getUTCDate() + n);
    return x;
  }

  function minusYear(d) {
    return new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate()));
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // "Aug 1 – 31, 2026", "Sep 28 – Oct 4, 2026", "Oct 5, 2026"
  function shortRange(a, b) {
    const [ay, am, ad, by, bm, bd] = [a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate(), b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()];
    if (a.getTime() === b.getTime()) return `${MONTHS[am]} ${ad}, ${ay}`;
    if (ay === by && am === bm) return `${MONTHS[am]} ${ad} – ${bd}, ${by}`;
    if (ay === by) return `${MONTHS[am]} ${ad} – ${MONTHS[bm]} ${bd}, ${by}`;
    return `${MONTHS[am]} ${ad}, ${ay} – ${MONTHS[bm]} ${bd}, ${by}`;
  }

  // start, end: Date (UTC midnight). The comparison period (PoP) is popStart..popEnd when given,
  // otherwise the same number of days right before. YoY = the same dates a year earlier.
  function buildPeriods(start, end, popStart, popEnd) {
    if (!popStart || !popEnd) {
      const days = Math.round((end - start) / 86400000) + 1;
      popEnd = addDays(start, -1);
      popStart = addDays(popEnd, -(days - 1));
    }
    const fmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return {
      current: { startDate: isoDate(start), endDate: isoDate(end), name: "current" },
      pop: { startDate: isoDate(popStart), endDate: isoDate(popEnd), name: "pop" },
      yoy: { startDate: isoDate(minusYear(start)), endDate: isoDate(minusYear(end)), name: "yoy" },
      label: `${fmt(start)} – ${fmt(end)}, ${end.getUTCFullYear()}`,
      popLabel: `${fmt(popStart)} – ${fmt(popEnd)}, ${popEnd.getUTCFullYear()}`,
      popShort: shortRange(popStart, popEnd),
      yoyLabel: `${fmt(minusYear(start))} – ${fmt(minusYear(end))}, ${minusYear(end).getUTCFullYear()}`,
    };
  }

  // ── GA4 query plan: all tabs = 15 reports in 3 batch calls ─────────────────

  // landingPage = page path without the query string.
  const SEGMENT_DIMS = { user_type: "newVsReturning", traffic_source: "sessionDefaultChannelGrouping", device: "deviceCategory", landing_page: "landingPage" };

  function funnelFilter() {
    return { filter: { fieldName: "eventName", inListFilter: { values: FUNNEL_EVENTS } } };
  }

  // Segment filters → one FilterExpression, combined with the request's own filter.
  // filters: {gaDimensionName: [values]}; empty lists are ignored.
  function withFilters(base, filters) {
    const exprs = Object.keys(filters || {}).filter((f) => filters[f] && filters[f].length)
      .map((fieldName) => ({ filter: { fieldName, inListFilter: { values: filters[fieldName] } } }));
    if (base) exprs.unshift(base);
    if (!exprs.length) return undefined;
    return exprs.length === 1 ? exprs[0] : { andGroup: { expressions: exprs } };
  }

  // Returns [{key, request}] in a fixed order. batchRunReports takes up to 5 per call.
  function requestPlan(periods, filters) {
    const three = [periods.current, periods.pop, periods.yoy];
    const cur = [periods.current];
    const curPop = [periods.current, periods.pop];
    const dims = (...names) => names.map((name) => ({ name }));
    const mets = (...names) => names.map((name) => ({ name }));
    const start = new Date(`${periods.current.startDate}T00:00:00Z`);
    const twelve = { startDate: isoDate(addDays(start, -365)), endDate: isoDate(addDays(start, -1)), name: "m12" };
    const plan = [
      // Map
      { key: "funnel", request: { dateRanges: three, dimensions: dims("eventName"), metrics: mets("sessions", "eventCount"), dimensionFilter: funnelFilter() } },
      { key: "agg", request: { dateRanges: three, metrics: mets(...AGG_METRICS) } },
      { key: "weeklyEvents", request: { dateRanges: cur, dimensions: dims("eventName", "yearWeek"), metrics: mets("sessions", "eventCount"), dimensionFilter: funnelFilter() } },
      { key: "weeklyAgg", request: { dateRanges: cur, dimensions: dims("yearWeek"), metrics: mets(...AGG_METRICS) } },
      { key: "weeklyChannels", request: { dateRanges: cur, dimensions: dims("sessionDefaultChannelGrouping", "yearWeek"), metrics: mets("sessions") } },
      { key: "channelsPop", request: { dateRanges: [periods.pop], dimensions: dims("sessionDefaultChannelGrouping"), metrics: mets("sessions") } },
      // Tree: 12 months by month for automatic targets
      { key: "monthly", request: { dateRanges: [twelve], dimensions: dims("eventName", "yearMonth"), metrics: mets("sessions"), dimensionFilter: funnelFilter() } },
    ];
    // Segments: A = funnel steps by segment (current), B = sessions/revenue by segment (current + PoP)
    Object.keys(SEGMENT_DIMS).forEach((k) => {
      const d = SEGMENT_DIMS[k];
      plan.push({ key: `segA_${k}`, request: { dateRanges: cur, dimensions: dims("eventName", d), metrics: mets("sessions"), dimensionFilter: funnelFilter() } });
      plan.push({ key: `segB_${k}`, request: { dateRanges: curPop, dimensions: dims(d), metrics: mets("sessions", "totalRevenue", "transactions") } });
    });
    plan.forEach((x) => {
      const f = withFilters(x.request.dimensionFilter, filters);
      if (f) x.request.dimensionFilter = f;
    });
    return plan;
  }

  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  // Report → array of plain objects keyed by header names (metrics as numbers).
  function reportRows(report) {
    const dh = ((report && report.dimensionHeaders) || []).map((h) => h.name);
    const mh = ((report && report.metricHeaders) || []).map((h) => h.name);
    return ((report && report.rows) || []).map((row) => {
      const o = {};
      (row.dimensionValues || []).forEach((v, i) => { o[dh[i] || `dim${i}`] = v.value; });
      (row.metricValues || []).forEach((v, i) => { o[mh[i]] = Number(v.value); });
      return o;
    });
  }

  // GA4 adds a "dateRange" dimension when a request has several date ranges.
  function byRange(rows, name) {
    return rows.filter((r) => r.dateRange === name);
  }

  function emptyAgg() {
    const o = {};
    AGG_METRICS.forEach((m) => { o[m] = 0; });
    return o;
  }

  function aggFor(rows, name) {
    const r = byRange(rows, name)[0];
    if (!r) return emptyAgg();
    const o = {};
    AGG_METRICS.forEach((m) => { o[m] = r[m] || 0; });
    return o;
  }

  function funnelFor(rows, name) {
    const o = {};
    FUNNEL_EVENTS.forEach((e) => { o[e] = 0; });
    o.view_item_count = 0;
    o.add_to_cart_count = 0;
    byRange(rows, name).forEach((r) => {
      o[r.eventName] = r.sessions || 0;
      if (r.eventName === "view_item") o.view_item_count = r.eventCount || 0;
      if (r.eventName === "add_to_cart") o.add_to_cart_count = r.eventCount || 0;
    });
    return o;
  }

  // rowsByKey: {key: rows[]} from requestPlan() keys.
  function toGa4Data(rowsByKey, periods, store) {
    const R = (k) => rowsByKey[k] || [];
    const aggYoy = aggFor(R("agg"), "yoy");
    const yoyAvailable = (aggYoy.sessions || 0) > 0;
    const segments = {};
    Object.keys(SEGMENT_DIMS).forEach((k) => {
      const d = SEGMENT_DIMS[k];
      const b = R(`segB_${k}`);
      const rowB = (r) => ({ segment: r[d], sessions: r.sessions, totalRevenue: r.totalRevenue, transactions: r.transactions });
      segments[k] = {
        query_a_current: R(`segA_${k}`).map((r) => ({ eventName: r.eventName, segment: r[d], sessions: r.sessions })),
        query_b_current: byRange(b, "current").map(rowB),
        query_b_pop: byRange(b, "pop").map(rowB),
      };
    });
    return {
      period_label: periods.label,
      period_pop_label: periods.popLabel,
      period_pop_short: periods.popShort,
      period_yoy_label: periods.yoyLabel,
      store,
      yoy_available: yoyAvailable,
      agg_current: aggFor(R("agg"), "current"),
      agg_pop: aggFor(R("agg"), "pop"),
      agg_yoy: yoyAvailable ? aggYoy : null,
      funnel_current: funnelFor(R("funnel"), "current"),
      funnel_pop: funnelFor(R("funnel"), "pop"),
      funnel_yoy: yoyAvailable ? funnelFor(R("funnel"), "yoy") : null,
      weekly_events: R("weeklyEvents").map((r) => ({ eventName: r.eventName, yearWeek: r.yearWeek, sessions: r.sessions, eventCount: r.eventCount })),
      weekly_agg: R("weeklyAgg").map((r) => {
        const o = { yearWeek: r.yearWeek };
        AGG_METRICS.forEach((m) => { o[m] = r[m] || 0; });
        return o;
      }),
      weekly_channels: R("weeklyChannels").map((r) => ({ channel: r.sessionDefaultChannelGrouping, yearWeek: r.yearWeek, sessions: r.sessions })),
      channels_pop: R("channelsPop").map((r) => ({ channel: r.sessionDefaultChannelGrouping, sessions: r.sessions })),
      monthly_events: R("monthly").map((r) => ({ eventName: r.eventName, yearMonth: r.yearMonth, sessions: r.sessions })),
      segments,
    };
  }

  // ── Formatting (processor.py) ──────────────────────────────────────────────

  const isNum = (v) => v !== null && v !== undefined && !Number.isNaN(v);

  function _div(a, b) {
    if (!b) return null;
    return a / b;
  }

  function _fmtInt(n) {
    if (!isNum(n)) return "n/a";
    return Math.round(n).toLocaleString("en-US");
  }

  function _fmtCurrency(v) {
    if (!isNum(v)) return "N/A";
    if (Math.abs(v) < 10) return `$${v.toFixed(2)}`;
    return `$${Math.round(v).toLocaleString("en-US")}`;
  }

  function _fmtPct(v) {
    if (!isNum(v)) return "n/a";
    return `${(v * 100).toFixed(1)}%`;
  }

  function _fmtRatio(v) {
    if (!isNum(v)) return "n/a";
    return v.toFixed(2);
  }

  // ── PoP / YoY change ───────────────────────────────────────────────────────

  function _change(cur, prev) {
    if (!isNum(cur) || !isNum(prev) || prev === 0) return null;
    return (cur - prev) / Math.abs(prev);
  }

  function _popFields(cur, prev, fmtPrev) {
    const pct = _change(cur, prev);
    const ppP = isNum(prev) ? fmtPrev(prev) : "";
    if (pct === null) return ["n/a", ppP, "", ""];
    const sign = pct >= 0 ? "+" : "";
    return [`${sign}${(pct * 100).toFixed(1)}%`, ppP, pct >= 0 ? "up" : "down", pct >= 0 ? "▲" : "▼"];
  }

  function _setChanges(p, prefix, cur, popVal, yoyVal, fmtPrev, yoyAvail) {
    const [ppV, ppP, ppC, ppA] = _popFields(cur, popVal, fmtPrev);
    p[`${prefix}_PP_V`] = ppV;
    p[`${prefix}_PP_P`] = ppP;
    p[`${prefix}_PP_C`] = ppC;
    p[`${prefix}_PP_A`] = ppA;
    const yy = yoyAvail && isNum(yoyVal) ? _popFields(cur, yoyVal, fmtPrev) : ["n/a", "", "", ""];
    p[`${prefix}_YY_V`] = yy[0];
    p[`${prefix}_YY_P`] = yy[1];
    p[`${prefix}_YY_C`] = yy[2];
    p[`${prefix}_YY_A`] = yy[3];
    p[`_YY_${prefix}`] = yoyAvail && isNum(yoyVal) ? _change(cur, yoyVal) : null;
    return _change(cur, popVal);
  }

  // ── Sparklines ─────────────────────────────────────────────────────────────

  function _sparkline(values, popPositive) {
    const valid = values.filter(isNum);
    if (valid.length < 2) {
      return { SP: "0,18 178,18", SF: "M0,18 L178,18 L178,36 L0,36 Z", SC: "#0E9C7D", SO: "0.12" };
    }
    const n = valid.length;
    const lo = Math.min(...valid);
    const hi = Math.max(...valid);
    const ny = (v) => (hi === lo ? 18 : Math.round(4 + ((hi - v) / (hi - lo)) * 28));
    const nx = (k) => Math.round((k * 178) / (n - 1));
    const pts = valid.map((v, k) => [nx(k), ny(v)]);
    const sp = pts.map(([x, y]) => `${x},${y}`).join(" ");
    const inner = pts.slice(1).map(([x, y]) => `L${x},${y}`).join(" ");
    const sf = `M${pts[0][0]},${pts[0][1]} ${inner} L${pts[n - 1][0]},36 L${pts[0][0]},36 Z`;
    let pos;
    if (popPositive === null || popPositive === undefined) {
      const nonNull = values.filter((v) => v !== null && v !== undefined);
      const first = nonNull.length ? nonNull[0] : 0;
      const last = nonNull.length ? nonNull[nonNull.length - 1] : 0;
      pos = last >= first;
    } else {
      pos = popPositive;
    }
    return { SP: sp, SF: sf, SC: pos ? "#0E9C7D" : "#FF5C60", SO: pos ? "0.15" : "0.12" };
  }

  function _setSparkline(p, prefix, values, popPositive) {
    const s = _sparkline(values, popPositive);
    Object.keys(s).forEach((k) => { p[`${prefix}_${k}`] = s[k]; });
  }

  // ── Badge positions (processor.py BADGE) ───────────────────────────────────

  const BADGE = {
    REV: ["353px", "125px", "195px"], AOV: ["655px", "31px", "195px"],
    ARP: ["655px", "219px", "195px"], CON: ["45px", "423px", "195px"],
    PUR: ["353px", "523px", "195px"], FST: ["655px", "423px", "195px"],
    CHP: ["45px", "623px", "195px"], RPT: ["655px", "623px", "195px"],
    ACK: ["45px", "835px", "195px"], CHK: ["353px", "835px", "195px"],
    PAC: ["45px", "1075px", "195px"], ATC: ["353px", "1075px", "195px"],
    ATS: ["655px", "1075px", "195px"], SPV: ["45px", "1315px", "195px"],
    PVC: ["353px", "1315px", "195px"], PVS: ["655px", "1315px", "195px"],
    SES: ["353px", "1555px", "195px"], SPU: ["655px", "1555px", "195px"],
    S1: ["30px", "1785px", "130px"], S2: ["172px", "1785px", "130px"],
    S3: ["314px", "1785px", "130px"], S4: ["456px", "1785px", "130px"],
    S5: ["598px", "1785px", "130px"], S6: ["740px", "1785px", "130px"],
  };

  // Same names as on the map cards, so the reader can find the card a verdict talks about.
  const CARD_LABELS = {
    REV: "Total Revenue", AOV: "Average Order Value", ARP: "ARPPC",
    CON: "CR Sessions → Purchase", CHP: "CR Checkout → Purchase", PUR: "Purchases",
    FST: "First time purchasers", RPT: "Repeat purchasers",
    ACK: "CR Add to Cart → Checkout", CHK: "Sessions with Checkout", ATS: "ATCs per Session",
    PAC: "CR Product Views → Add to Cart", ATC: "Sessions with Add to Cart",
    SPV: "CR Sessions → Product Views", PVC: "Sessions with Product Views", PVS: "Product Views per Session",
    SES: "Sessions", SPU: "Sessions per User",
  };

  // ── Map tab ────────────────────────────────────────────────────────────────

  function processMap(d) {
    const p = {};
    const yoy = !!d.yoy_available;
    const cur = d.agg_current, pop = d.agg_pop, yoyA = yoy ? d.agg_yoy : null;
    const fc = d.funnel_current, fp = d.funnel_pop, fyA = yoy ? d.funnel_yoy : null;
    const verdicts = d.verdicts || {};

    const byWeek = (a, b) => (a.yearWeek < b.yearWeek ? -1 : a.yearWeek > b.yearWeek ? 1 : 0);
    const wa = [...(d.weekly_agg || [])].sort(byWeek);
    const we = [...(d.weekly_events || [])].sort(byWeek);
    const wc = [...(d.weekly_channels || [])].sort(byWeek);
    const chPop = {};
    (d.channels_pop || []).forEach((r) => { chPop[r.channel] = r.sessions; });
    const weeks = [...new Set(wa.map((r) => r.yearWeek))].sort();

    const aggW = (field) => {
      const m = {};
      wa.forEach((r) => { m[r.yearWeek] = r[field] || 0; });
      return weeks.map((w) => (w in m ? m[w] : 0));
    };
    const evW = (name, field = "sessions") => {
      const m = {};
      we.filter((r) => r.eventName === name).forEach((r) => { m[r.yearWeek] = r[field] || 0; });
      return weeks.map((w) => (w in m ? m[w] : 0));
    };
    const crW = (num, den) => num.map((n, i) => _div(n, den[i]));

    // Current
    const s = cur.sessions, rev = cur.totalRevenue, txn = cur.transactions;
    const ftp = cur.firstTimePurchasers, tp = cur.totalPurchasers, tu = cur.totalUsers;
    const aov = _div(rev, txn), arpc = _div(rev, tp), rpt = tp - ftp, spu = _div(s, tu);
    const s2 = fc.view_item, s3 = fc.add_to_cart, s4 = fc.begin_checkout, s5 = fc.purchase;
    const pvc = fc.view_item_count ?? s2, atcc = fc.add_to_cart_count ?? s3;
    const crSp = _div(s5, s), crCp = _div(s5, s4), crAc = _div(s4, s3), crPa = _div(s3, s2), crSv = _div(s2, s);
    const ats = _div(atcc, s), pvs = _div(pvc, s);

    // PoP
    const sP = pop.sessions, revP = pop.totalRevenue, txnP = pop.transactions;
    const ftpP = pop.firstTimePurchasers, tpP = pop.totalPurchasers, tuP = pop.totalUsers;
    const aovP = _div(revP, txnP), arpcP = _div(revP, tpP), rptP = tpP - ftpP, spuP = _div(sP, tuP);
    const s2P = fp.view_item, s3P = fp.add_to_cart, s4P = fp.begin_checkout, s5P = fp.purchase;
    const pvcP = fp.view_item_count ?? s2P, atccP = fp.add_to_cart_count ?? s3P;
    const crSpP = _div(s5P, sP), crCpP = _div(s5P, s4P), crAcP = _div(s4P, s3P), crPaP = _div(s3P, s2P), crSvP = _div(s2P, sP);
    const atsP = _div(atccP, sP), pvsP = _div(pvcP, sP);

    // YoY
    let sY = null, revY = null, ftpY = null, aovY = null, arpcY = null, rptY = null, spuY = null;
    let s2Y = null, s3Y = null, s4Y = null, s5Y = null;
    let crSpY = null, crCpY = null, crAcY = null, crPaY = null, crSvY = null, atsY = null, pvsY = null;
    if (yoy && yoyA && fyA) {
      sY = yoyA.sessions; revY = yoyA.totalRevenue; ftpY = yoyA.firstTimePurchasers;
      const txnY = yoyA.transactions, tpY = yoyA.totalPurchasers, tuY = yoyA.totalUsers;
      aovY = _div(revY, txnY); arpcY = _div(revY, tpY); rptY = tpY - ftpY; spuY = _div(sY, tuY);
      s2Y = fyA.view_item; s3Y = fyA.add_to_cart; s4Y = fyA.begin_checkout; s5Y = fyA.purchase;
      const pvcY = fyA.view_item_count ?? s2Y, atccY = fyA.add_to_cart_count ?? s3Y;
      crSpY = _div(s5Y, sY); crCpY = _div(s5Y, s4Y); crAcY = _div(s4Y, s3Y); crPaY = _div(s3Y, s2Y); crSvY = _div(s2Y, sY);
      atsY = _div(atccY, sY); pvsY = _div(pvcY, sY);
    }

    p.STORE = d.store || "";
    p.PERIOD = d.period_label || "";
    p.MV_RV = verdicts.revenue || "";
    p.MV_DR = verdicts.driving || "";
    p.MV_WC = verdicts.watch || "";
    Object.keys(BADGE).forEach((k) => { p[`${k}_XC`] = ""; });

    const popPcts = {};

    const wS = aggW("sessions"), wRev = aggW("totalRevenue"), wTxn = aggW("transactions");
    const wFtp = aggW("firstTimePurchasers"), wTp = aggW("totalPurchasers");
    const wS5 = evW("purchase"), wS4 = evW("begin_checkout"), wS3 = evW("add_to_cart"), wS2 = evW("view_item");
    const wPvc = evW("view_item", "eventCount"), wAtcc = evW("add_to_cart", "eventCount");
    const wRpt = wTp.map((a, i) => Math.max(0, a - wFtp[i]));
    const wAov = crW(wRev, wTxn), wArpc = crW(wRev, wTp);
    const wCrSp = crW(wS5, wS), wCrCp = crW(wS5, wS4), wCrAc = crW(wS4, wS3), wCrPa = crW(wS3, wS2), wCrSv = crW(wS2, wS);
    const wAts = crW(wAtcc, wS), wPvs = crW(wPvc, wS);

    const card = (pfx, curV, popV, yoyV, valStr, fmt, weekly, popPositive = null) => {
      p[`${pfx}_VAL`] = valStr;
      popPcts[pfx] = _setChanges(p, pfx, curV, popV, yoyV, fmt, yoy);
      const pos = isNum(curV) && isNum(popV) ? curV >= popV : popPositive;
      _setSparkline(p, pfx, weekly, pos);
    };

    card("REV", rev, revP, revY, _fmtCurrency(rev), _fmtCurrency, wRev);
    card("AOV", aov, aovP, aovY, aov ? _fmtCurrency(aov) : "N/A", _fmtCurrency, wAov);
    card("ARP", arpc, arpcP, arpcY, arpc ? _fmtCurrency(arpc) : "N/A", _fmtCurrency, wArpc);

    card("CON", crSp, crSpP, crSpY, _fmtPct(crSp), _fmtPct, wCrSp);
    card("CHP", crCp, crCpP, crCpY, _fmtPct(crCp), _fmtPct, wCrCp);
    card("PUR", s5, s5P, s5Y, _fmtInt(s5), _fmtInt, wS5);
    card("FST", ftp, ftpP, ftpY, _fmtInt(ftp), _fmtInt, wFtp);
    card("RPT", rpt, rptP, rptY, _fmtInt(rpt), _fmtInt, wRpt);

    card("ACK", crAc, crAcP, crAcY, _fmtPct(crAc), _fmtPct, wCrAc);
    card("CHK", s4, s4P, s4Y, _fmtInt(s4), _fmtInt, wS4);
    card("ATS", ats, atsP, atsY, _fmtRatio(ats), _fmtRatio, wAts);

    card("PAC", crPa, crPaP, crPaY, _fmtPct(crPa), _fmtPct, wCrPa);
    card("ATC", s3, s3P, s3Y, _fmtInt(s3), _fmtInt, wS3);

    card("SPV", crSv, crSvP, crSvY, _fmtPct(crSv), _fmtPct, wCrSv);
    card("PVC", s2, s2P, s2Y, _fmtInt(s2), _fmtInt, wS2);
    card("PVS", pvs, pvsP, pvsY, _fmtRatio(pvs), _fmtRatio, wPvs);

    card("SES", s, sP, sY, _fmtInt(s), _fmtInt, wS);
    card("SPU", spu, spuP, spuY, _fmtRatio(spu), _fmtRatio, wS.map((a, i) => _div(a, aggW("totalUsers")[i])));

    // Source cards S1–S6
    const chCur = {};
    wc.forEach((r) => { chCur[r.channel] = (chCur[r.channel] || 0) + r.sessions; });
    const top6 = Object.keys(chCur).sort((a, b) => chCur[b] - chCur[a]).slice(0, 6);
    top6.forEach((ch, i) => {
      const pfx = `S${i + 1}`;
      const curS = chCur[ch];
      const popS = chPop[ch] || 0;
      p[`${pfx}_N`] = ch;
      p[`${pfx}_VAL`] = _fmtInt(curS);
      popPcts[pfx] = _setChanges(p, pfx, curS, popS, null, _fmtInt, yoy);
      const chW = {};
      wc.filter((r) => r.channel === ch).forEach((r) => { chW[r.yearWeek] = r.sessions; });
      _setSparkline(p, pfx, weeks.map((w) => chW[w] || 0), curS >= popS);
    });
    for (let i = top6.length + 1; i <= 6; i++) {
      const pfx = `S${i}`;
      ["N", "VAL", "PP_V", "PP_P", "PP_C", "PP_A", "YY_V", "YY_P", "YY_C", "YY_A"].forEach((sfx) => { p[`${pfx}_${sfx}`] = ""; });
      p[`${pfx}_SP`] = "0,18 178,18";
      p[`${pfx}_SF`] = "M0,18 L178,18 L178,36 L0,36 Z";
      p[`${pfx}_SC`] = "#CCC";
      p[`${pfx}_SO`] = "0.05";
    }

    // Problem badge: candidates are cards where every available comparison (PoP, YoY) is down;
    // the biggest mean drop wins. If nothing went down, the card that grew the least.
    let worst = null, worstScore = 0, badgeTxt;
    for (const k of Object.keys(popPcts)) {
      if (!(k in BADGE)) continue;
      const comps = [popPcts[k], p[`_YY_${k}`]].filter((v) => v !== null && v !== undefined);
      if (!comps.length || comps.some((v) => v >= 0)) continue;
      const score = comps.reduce((a, v) => a + Math.abs(v), 0) / comps.length;
      if (worst === null || score > worstScore) { worst = k; worstScore = score; }
    }
    if (worst !== null) {
      badgeTxt = "⚠ Need attention";
    } else {
      for (const k of Object.keys(popPcts)) {
        const v = popPcts[k];
        if (!(k in BADGE) || v === null || v < 0) continue;
        if (worst === null || v < popPcts[worst]) worst = k;
      }
      if (worst === null) worst = "PUR";
      badgeTxt = "Slowest growth";
    }
    p[`${worst}_XC`] = " problem";
    const [lft, top, wdt] = BADGE[worst];
    p.BG_DSP = "block"; p.BG_LFT = lft; p.BG_TOP = top; p.BG_WDT = wdt; p.BG_TXT = badgeTxt;
    p.BG_TIP = _badgeTip(p, worst, badgeTxt.includes("Need"), popPcts[worst]);

    // Arrow colours: how the card an arrow starts from changed (PoP), like the ▲▼ on that card.
    // SRC = the shared trunk from the traffic sources into Sessions, coloured like Sessions.
    const arrow = (v) => (v === null || v === undefined ? ["#C8C8C8", "an"] : v >= 0 ? ["#0E9C7D", "ag"] : ["#FF5C60", "ar"]);
    // Where two arrows merge, the shared end takes the colour of the card they point to (REV, PUR).
    ["REV", "PUR", "AOV", "ARP", "CON", "CHP", "CHK", "ACK", "ATC", "PAC", "PVC", "SPV", "SES", "S1", "S2", "S3", "S4", "S5", "S6"].forEach((k) => {
      [p[`AC_${k}`], p[`AM_${k}`]] = arrow(popPcts[k]);
    });
    [p.AC_SRC, p.AM_SRC] = arrow(popPcts.SES);

    // What-if model
    p.MD_SS = String(Math.trunc(s || 0));
    p.MD_CR = (crSp || 0).toFixed(4);
    p.MD_RV = (rev || 0).toFixed(2);
    p.MD_AV = (aov || 0).toFixed(2);
    p.MD_M1 = (crSv || 0).toFixed(4);
    p.MD_M2 = (crPa || 0).toFixed(4);
    p.MD_M3 = (crAc || 0).toFixed(4);
    p.MD_M4 = (crCp || 0).toFixed(4);
    p.MI_1 = ((crSv || 0) * 100).toFixed(1);
    p.MI_2 = ((crPa || 0) * 100).toFixed(1);
    p.MI_3 = ((crAc || 0) * 100).toFixed(1);
    p.MI_4 = ((crCp || 0) * 100).toFixed(1);

    p.TREE_EMPTY_STATE = '<div class="empty-state-bar"><span>Driver Tree is coming in the next prototype step</span></div>';
    p.SEG_EMPTY_STATE = '<div class="empty-state-bar"><span>Segments are coming in the next prototype step</span></div>';

    // Exposed for verdicts (not template placeholders)
    p.BODY_CLS = yoy ? "" : "no-yoy";
    p._badge = worst;
    p._badgePct = isNum(popPcts[worst]) ? popPcts[worst] : null;
    p._pop = { rev: _change(rev, revP), ses: _change(s, sP), cr: _change(crSp, crSpP), aov: _change(aov, aovP) };
    p._rev = { cur: rev || 0, pop: revP || 0, yoy: yoy ? _change(rev, revY) : null, tx: cur.transactions || 0 };
    p._purPct = isNum(popPcts.PUR) ? popPcts.PUR : null;
    return p;
  }

  // Card name for texts; traffic source cards are "<channel> sessions".
  function _cardLabel(p, k) {
    if (CARD_LABELS[k]) return CARD_LABELS[k];
    return /^S\d$/.test(k) && p[`${k}_N`] ? `${p[`${k}_N`]} sessions` : k;
  }

  // Hover hint for the badge: why this card. No dates, the cards already carry PoP / YoY.
  function _badgeTip(p, k, needAttention, pop) {
    const label = _esc(_cardLabel(p, k));
    const yoy = p[`_YY_${k}`];
    const pct = (v) => `${(Math.abs(v) * 100).toFixed(1)}%`;
    if (pop === null || pop === undefined) {
      return `<div class="tip-h">Why this card is marked</div><p>There is not enough data in the comparison period to compare the cards.</p>`;
    }
    if (needAttention) {
      const drop = `${pct(pop)} PoP` + (yoy !== null && yoy !== undefined ? ` and ${pct(yoy)} YoY` : "");
      return `<div class="tip-h">Why “Need attention” is here</div><p><b>${label}</b> dropped ${drop}.</p>` +
        `<p>The mark goes to the card with the biggest drop among cards where every comparison is down.</p>`;
    }
    return `<div class="tip-h">Why “Slowest growth” is here</div><p>Nothing on the map went down, so the mark goes to the card that grew the least: <b>${label}</b>, up ${pct(pop)} PoP.</p>`;
  }

  // ── Verdicts above the map: rule-based, written for any situation ─────────
  // Revenue = Sessions × Conversion rate × Average order value: say what moved revenue and what to check.

  const FLAT = 0.01; // changes under 1% count as "held steady"

  function signedPct(v) {
    if (v === null) return "n/a";
    return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
  }

  // A signed change in green (up) or red (down); tiny changes stay uncoloured.
  function hiPct(v) {
    if (v === null || v === undefined) return "n/a";
    const t = signedPct(v);
    return Math.abs(v) < FLAT ? t : `<span class="${v > 0 ? "hi-good" : "hi-bad"}">${t}</span>`;
  }

  // The size of a change without its sign, coloured by direction ("down 93.4%").
  function hiAbs(v) {
    const t = `${(Math.abs(v) * 100).toFixed(1)}%`;
    return Math.abs(v) < FLAT ? t : `<span class="${v > 0 ? "hi-good" : "hi-bad"}">${t}</span>`;
  }

  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const joinAnd = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

  // d (optional) gives the comparison period's dates for the sentences.
  function buildVerdicts(p, d) {
    const pp = p._pop, r = p._rev;
    const popTxt = (d && d.period_pop_short) || "the comparison period";
    const noRevenue = !r.cur && !r.pop;

    // Revenue
    let revenue;
    if (noRevenue) {
      revenue = r.tx
        ? "No revenue recorded in GA4, although there are purchases. Revenue may not be sent with purchase events."
        : "No revenue recorded in GA4 for this period.";
    } else if (pp.rev === null) {
      revenue = `<b>${p.REV_VAL}</b>. There was no revenue in ${popTxt}.`;
    } else {
      const move = (v) => (Math.abs(v) < FLAT ? "almost unchanged" : `${v > 0 ? "up" : "down"} ${hiAbs(v)}`);
      revenue = `<b>${p.REV_VAL}</b>, ${move(pp.rev)} from ${popTxt}` + (r.yoy !== null ? `, and ${move(r.yoy)} from a year earlier` : "") + ".";
    }

    // What's driving it: Revenue = Sessions × Conversion rate × Average order value
    // (without revenue in GA4: Purchases = Sessions × Conversion rate).
    const what = noRevenue ? "purchases" : "revenue";
    const names = { ses: "sessions", cr: "conversion rate", aov: "average order value" };
    const f = (noRevenue ? ["ses", "cr"] : ["ses", "cr", "aov"]).filter((k) => pp[k] !== null).map((k) => [names[k], pp[k]]);
    let driving;
    if (!f.length) {
      driving = "Not enough data in the comparison period to explain the change.";
    } else {
      const up = f.filter(([, v]) => v >= FLAT).sort((a, b) => b[1] - a[1]);
      const down = f.filter(([, v]) => v <= -FLAT).sort((a, b) => a[1] - b[1]);
      const flat = f.filter(([, v]) => Math.abs(v) < FLAT).map(([n]) => n);
      // "sessions rose 11.0%" or "sessions (+59.6%) and conversion rate (+39.6%) rose"
      const moves = (xs, first) => {
        const nm = (n, i) => `<b>${first && i === 0 ? cap(n) : n}</b>`;
        const verb = xs[0][1] > 0 ? "rose" : "dropped";
        return xs.length === 1 ? `${nm(xs[0][0], 0)} ${verb} ${hiAbs(xs[0][1])}` : `${joinAnd(xs.map(([n, v], i) => `${nm(n, i)} (${hiPct(v)})`))} ${verb}`;
      };
      const lead = noRevenue ? p._purPct : pp.rev;
      const sentences = [];
      if (lead === null || lead === undefined) {
        const parts = [up, down].filter((xs) => xs.length);
        if (parts.length) sentences.push(parts.map((xs, i) => moves(xs, i === 0)).join(", while ") + ".");
      } else if (Math.abs(lead) < FLAT) {
        if (up.length && down.length) sentences.push(`${cap(what)} held steady: ${moves(up, false)}, while ${moves(down, false)}.`);
        else if (up.length || down.length) sentences.push(`${cap(what)} held steady, although ${moves(up.length ? up : down, false)}.`);
      } else {
        const grew = lead > 0;
        const [main, counter] = grew ? [up, down] : [down, up];
        if (main.length) sentences.push(`${cap(what)} ${grew ? "grew" : "fell"} because ${moves(main, false)}.`);
        else if (counter.length) {
          // All three factors known and none explains it: what is left is orders per purchasing session.
          const rest = f.length === 3 ? ` The change comes from the number of orders per purchasing session.` : "";
          sentences.push(`${cap(what)} ${grew ? "grew" : "fell"} even though ${moves(counter, false)}.${rest}`);
        }
        if (main.length && counter.length) sentences.push(`${moves(counter, true)}, but not enough to ${grew ? "hold it back" : "make up for it"}.`);
      }
      if (flat.length) sentences.push(`${cap(joinAnd(flat))} held steady.`);
      driving = sentences.join(" ");
    }

    // Watch: the badge on the map
    const k = p._badge, v = p._badgePct;
    const label = _esc(_cardLabel(p, k));
    let watch;
    if (v === null) watch = "Nothing to flag yet: there is not enough data in the comparison period.";
    else if (v < 0) watch = `<b>${label}</b> fell the most: down ${hiAbs(v)} to ${p[`${k}_VAL`]}.`;
    else if (v < FLAT) watch = `Nothing fell. <b>${label}</b> grew the slowest and is almost unchanged at ${p[`${k}_VAL`]}.`;
    else watch = `Nothing fell. <b>${label}</b> grew the slowest: up ${hiAbs(v)} to ${p[`${k}_VAL`]}.`;

    return { MV_RV: revenue, MV_DR: driving, MV_WC: watch };
  }

  // ── Targets for the Driver Tree (option A: best month of the last 12) ──────

  function autoTargets(monthly) {
    const months = {};
    (monthly || []).forEach((r) => {
      months[r.yearMonth] = months[r.yearMonth] || {};
      months[r.yearMonth][r.eventName] = r.sessions || 0;
    });
    const best = { s_pv: null, pv_atc: null, atc_chk: null, chk_pur: null };
    let n = 0;
    Object.keys(months).forEach((m) => {
      const e = months[m];
      if (!e.session_start) return;
      n += 1;
      const crs = {
        s_pv: _div(e.view_item || 0, e.session_start),
        pv_atc: _div(e.add_to_cart || 0, e.view_item || 0),
        atc_chk: _div(e.begin_checkout || 0, e.add_to_cart || 0),
        chk_pur: _div(e.purchase || 0, e.begin_checkout || 0),
      };
      Object.keys(crs).forEach((k) => {
        if (isNum(crs[k]) && (best[k] === null || crs[k] > best[k])) best[k] = crs[k];
      });
    });
    if (n < 3 || Object.values(best).some((v) => v === null)) return { months: n, targets: null };
    return { months: n, targets: { ...best, overall: best.s_pv * best.pv_atc * best.atc_chk * best.chk_pur } };
  }

  // Target options per funnel step from the monthly history (the 12 months before the period):
  // best = the best month, avg = the level of the last 3 months (sum of the step's sessions / sum of the previous step's).
  const TARGET_STEPS = { s_pv: ["session_start", "view_item"], pv_atc: ["view_item", "add_to_cart"], atc_chk: ["add_to_cart", "begin_checkout"], chk_pur: ["begin_checkout", "purchase"] };

  function targetOptions(monthly) {
    const months = {};
    (monthly || []).forEach((r) => {
      months[r.yearMonth] = months[r.yearMonth] || {};
      months[r.yearMonth][r.eventName] = r.sessions || 0;
    });
    const keys = Object.keys(months).filter((m) => months[m].session_start).sort();
    const best = {}, avg = {};
    Object.keys(TARGET_STEPS).forEach((k) => {
      const [a, b] = TARGET_STEPS[k];
      const rates = keys.map((m) => _div(months[m][b] || 0, months[m][a] || 0)).filter(isNum);
      best[k] = rates.length ? Math.max(...rates) : null;
      let num = 0, den = 0;
      keys.slice(-3).forEach((m) => { num += months[m][b] || 0; den += months[m][a] || 0; });
      avg[k] = den ? num / den : null;
    });
    return { months: keys.length, best, avg };
  }

  // ── Tree tab (processor.py process_tree) ───────────────────────────────────

  const ZONE_COLOR = { good: "#0E9C7D", warn: "#FF9500", bad: "#FF5C60" };
  const TREE_LABELS = { TR1: "Checkout → Purchase", TR2: "Add to Cart → Checkout", TR3: "Product Views → Add to Cart", TR4: "Sessions → Product Views" };

  function _zone(actual, target) {
    if (!isNum(actual) || !target) return "bad";
    if (actual >= target) return "good";
    if (actual >= target * 0.85) return "warn";
    return "bad";
  }

  function _treeCard(pfx, actual, target, p) {
    const zone = _zone(actual, target);
    const ratio = _div(actual, target) || 0;
    const gapPp = isNum(actual) && target ? (actual - target) * 100 : 0;
    p[`${pfx}_VAL`] = _fmtPct(actual);
    p[`${pfx}_Z`] = `zone-${zone}`;
    p[`${pfx}_GC`] = `zone-${zone}-text`;
    p[`${pfx}_GA`] = gapPp >= 0 ? "▲" : "▼";
    p[`${pfx}_GP`] = `${gapPp >= 0 ? "+" : ""}${gapPp.toFixed(1)}pp`;
    p[`${pfx}_TG`] = _fmtPct(target);
    p[`${pfx}_FW`] = `${Math.min(100, Math.round(ratio * 100))}%`;
    p[`${pfx}_PT`] = `${Math.round(ratio * 100)}%`;
    return zone;
  }

  function processTree(d, t) {
    const p = {};
    const cur = d.agg_current, fc = d.funnel_current;
    const s = cur.sessions, rev = cur.totalRevenue, aov = _div(rev, cur.transactions);
    const s1 = fc.session_start, s2 = fc.view_item, s3 = fc.add_to_cart, s4 = fc.begin_checkout, s5 = fc.purchase;
    const crSp = _div(s5, s), crCp = _div(s5, s4), crAc = _div(s4, s3), crPa = _div(s3, s2), crSv = _div(s2, s);

    const zones = {
      TR0: _treeCard("TR0", crSp, t.overall, p),
      TR1: _treeCard("TR1", crCp, t.chk_pur, p),
      TR2: _treeCard("TR2", crAc, t.atc_chk, p),
      TR3: _treeCard("TR3", crPa, t.pv_atc, p),
      TR4: _treeCard("TR4", crSv, t.s_pv, p),
    };

    const totalLoss = s1 - s5;
    const shares = {};
    [["TA1", "TR1", s4 - s5], ["TA2", "TR2", s3 - s4], ["TA3", "TR3", s2 - s3], ["TA4", "TR4", s1 - s2]].forEach(([ta, tr, loss]) => {
      const share = Math.max(0, Math.round((_div(loss, totalLoss) || 0) * 100));
      shares[tr] = share;
      p[`${ta}_SC`] = ZONE_COLOR[zones[tr]];
      p[`${ta}_SW`] = (1 + (share / 100) * 3).toFixed(1);
      p[`${ta}_MK`] = zones[tr];
      p[`${ta}_LS`] = `${share}%`;
    });

    p.MD_SS = String(Math.trunc(s || 0));
    p.MD_CR = (crSp || 0).toFixed(4);
    p.MD_RV = (rev || 0).toFixed(2);
    p.MD_AV = (aov || 0).toFixed(2);
    p.MD_M1 = (crCp || 0).toFixed(4);
    p.MD_M2 = (crAc || 0).toFixed(4);
    p.MD_M3 = (crPa || 0).toFixed(4);
    p.MD_M4 = (crSv || 0).toFixed(4);
    p.MI_1 = (t.chk_pur * 100).toFixed(1);
    p.MI_2 = (t.atc_chk * 100).toFixed(1);
    p.MI_3 = (t.pv_atc * 100).toFixed(1);
    p.MI_4 = (t.s_pv * 100).toFixed(1);

    // Deterministic verdicts (prototype)
    const hi = (zone, text) => `<span class="${zone === "good" ? "hi-good" : "hi-bad"}">${text}</span>`;
    const gap = isNum(crSp) && t.overall ? (crSp - t.overall) * 100 : 0;
    p.TV_OV = `${hi(zones.TR0, p.TR0_VAL)}, ${Math.abs(gap).toFixed(1)} pp ${gap >= 0 ? "above" : "below"} the ${p.TR0_TG} target.`;
    const steps = ["TR1", "TR2", "TR3", "TR4"];
    const rank = { bad: 0, warn: 1, good: 2 };
    // Bottleneck = the step below its target that loses the biggest share of sessions.
    const worst = steps.filter((k) => zones[k] !== "good").sort((a, b) => shares[b] - shares[a] || rank[zones[a]] - rank[zones[b]])[0];
    p.TV_BT = worst
      ? `${TREE_LABELS[worst]} converts ${hi("bad", p[`${worst}_VAL`])} against a ${p[`${worst}_TG`]} target.` +
        (shares[worst] > 0 ? ` ${shares[worst]}% of the sessions lost before purchase drop off here.` : "")
      : "All steps meet their targets.";
    const actual = { TR1: crCp, TR2: crAc, TR3: crPa, TR4: crSv };
    const target = { TR1: t.chk_pur, TR2: t.atc_chk, TR3: t.pv_atc, TR4: t.s_pv };
    const ahead = steps.filter((k) => isNum(actual[k]) && target[k] && actual[k] - target[k] >= 0.0005);
    const bestStep = ahead.sort((a, b) => actual[b] / target[b] - actual[a] / target[a])[0];
    p.TV_HL = bestStep
      ? `<div class="verdict-row"><span class="verdict-label">Highlight</span><span class="verdict-text">${TREE_LABELS[bestStep]} beats its target: ${hi("good", p[`${bestStep}_VAL`])} against ${p[`${bestStep}_TG`]}.</span></div>`
      : "";
    p.TREE_EMPTY_STATE = "";
    return p;
  }

  // ── Segments tab (processor.py process_segments) ───────────────────────────

  const SEG_PREFIX = { user_type: "UT", traffic_source: "SC", device: "DV", landing_page: "LP" };

  // Landing pages: top 5 by current sessions, the rest summed into "Other"; technical values left out.
  // The Total row still comes from the global aggregates.
  const LP_EXCLUDE = ["(not set)", "(direct)", "Unassigned"];
  const LP_TOP = 5;

  function _groupLanding(seg) {
    const keep = (r) => !LP_EXCLUDE.includes(r.segment);
    const top = seg.query_b_current.filter(keep).sort((a, b) => b.sessions - a.sessions).slice(0, LP_TOP).map((r) => r.segment);
    const name = (s) => (top.includes(s) ? s : "Other");
    const groupB = (rows) => {
      const out = new Map();
      rows.filter(keep).forEach((r) => {
        const n = name(r.segment);
        const o = out.get(n) || { segment: n, sessions: 0, totalRevenue: 0, transactions: 0 };
        o.sessions += r.sessions || 0;
        o.totalRevenue += r.totalRevenue || 0;
        o.transactions += r.transactions || 0;
        out.set(n, o);
      });
      return [...out.values()];
    };
    const a = new Map();
    seg.query_a_current.filter(keep).forEach((r) => {
      const n = name(r.segment), k = `${n}|${r.eventName}`;
      const o = a.get(k) || { eventName: r.eventName, segment: n, sessions: 0 };
      o.sessions += r.sessions || 0;
      a.set(k, o);
    });
    const ordered = groupB(seg.query_b_current).sort((x, y) => (x.segment === "Other") - (y.segment === "Other") || y.sessions - x.sessions);
    return { query_a_current: [...a.values()], query_b_current: ordered, query_b_pop: groupB(seg.query_b_pop) };
  }

  function _rowsFor(key, seg) {
    const g = key === "landing_page" ? _groupLanding(seg) : seg;
    return _segmentRows(g.query_a_current, g.query_b_current, g.query_b_pop);
  }

  // Segment names come from GA4 as is (landing page paths included): escape before putting them into HTML.
  function _esc(v) {
    return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function _mcClass(val, totalVal) {
    if (!isNum(val) || !isNum(totalVal) || totalVal === 0) return "";
    if (val >= totalVal * 0.97) return "mc-good";
    if (val >= totalVal * 0.85) return "mc-warn";
    return "mc-bad";
  }

  function _fmtDelta(delta) {
    if (!isNum(delta)) return ["n/a", ""];
    if (delta >= 0) return [`+${_fmtCurrency(delta)}`, "pos"];
    return [`−${_fmtCurrency(Math.abs(delta))}`, "neg"];
  }

  function _rowMetrics(r) {
    const popRev = r.pop_revenue;
    return {
      cr1: _div(r.s2, r.sessions), cr2: _div(r.s3, r.s2), cr3: _div(r.s4, r.s3), cr4: _div(r.s5, r.s4),
      crp: _div(r.s5, r.sessions), aov: _div(r.revenue, r.transactions),
      delta: isNum(popRev) ? r.revenue - popRev : null,
    };
  }

  function _segmentRows(qa, qb, qbPop) {
    const ev = {};
    qa.forEach((r) => { (ev[r.segment] = ev[r.segment] || {})[r.eventName] = r.sessions; });
    const popRev = {};
    qbPop.forEach((r) => { popRev[r.segment] = r.totalRevenue; });
    return qb.map((r) => {
      const e = ev[r.segment] || {};
      return {
        name: r.segment, sessions: r.sessions || 0,
        s2: e.view_item || 0, s3: e.add_to_cart || 0, s4: e.begin_checkout || 0, s5: e.purchase || 0,
        revenue: r.totalRevenue || 0, transactions: r.transactions || 0,
        pop_revenue: popRev[r.segment] || 0,
      };
    });
  }

  function _segmentTable(rows, totals) {
    const t = _rowMetrics(totals);
    const totalDelta = t.delta || 0;
    const totalPopRev = totals.pop_revenue || 0;
    let problem = null, bestOvershoot = null;
    if (rows.length && totalPopRev) {
      rows.forEach((r) => {
        const expected = (_div(r.pop_revenue || 0, totalPopRev) || 0) * totalDelta;
        const overshoot = (_rowMetrics(r).delta || 0) - expected;
        if (bestOvershoot === null || overshoot < bestOvershoot) { problem = r.name; bestOvershoot = overshoot; }
      });
    }
    const render = (name, sessions, m, purchases, revenue, rowCls, cls) => {
      const [dtxt, dcls] = _fmtDelta(m.delta);
      let tip = `title="${_esc(name)}"`;
      if (rowCls === "problem-row") {
        const dl = m.delta || 0;
        const change = dl < 0 ? `fell by ${_fmtCurrency(-dl)}` : dl > 0 ? `grew by only ${_fmtCurrency(dl)}` : "did not change";
        tip = `data-tip-text="${_esc(`<div class="tip-h">Why this row is highlighted</div><p>Revenue from <b>${_esc(name)}</b> ${change}, the furthest behind what its share of total revenue would suggest.</p>`)}"`;
      }
      return `<tr class="${rowCls}"><td class="seg-name" ${tip}><span>${_esc(name)}</span></td><td>${_fmtInt(sessions)}</td>` +
        `<td class="${cls[0]}">${_fmtPct(m.cr1)}</td><td class="${cls[1]}">${_fmtPct(m.cr2)}</td>` +
        `<td class="${cls[2]}">${_fmtPct(m.cr3)}</td><td class="${cls[3]}">${_fmtPct(m.cr4)}</td>` +
        `<td class="${cls[4]}">${_fmtPct(m.crp)}</td><td>${_fmtInt(purchases)}</td>` +
        `<td>${m.aov ? _fmtCurrency(m.aov) : "N/A"}</td><td>${_fmtCurrency(revenue)}</td><td class="${dcls}">${dtxt}</td></tr>`;
    };
    const trs = rows.map((r) => {
      const m = _rowMetrics(r);
      return render(r.name, r.sessions, m, r.s5, r.revenue, r.name === problem ? "problem-row" : "",
        [_mcClass(m.cr1, t.cr1), _mcClass(m.cr2, t.cr2), _mcClass(m.cr3, t.cr3), _mcClass(m.cr4, t.cr4), _mcClass(m.crp, t.crp)]);
    });
    trs.push(render("Total", totals.sessions, t, totals.s5, totals.revenue, "total-row", ["", "", "", "", ""]));
    return { html: trs.join("\n"), problem, overshoot: bestOvershoot };
  }

  function _segmentInsight(key, rows, totals, problem, overshoot) {
    const t = _rowMetrics(totals);
    const sized = rows.filter((r) => r.name !== "(not set)" && r.sessions >= totals.sessions * 0.05);
    const parts = [];
    if (sized.length >= 2) {
      const best = sized.reduce((a, b) => ((_rowMetrics(b).crp || 0) > (_rowMetrics(a).crp || 0) ? b : a));
      parts.push(`<b>${_esc(best.name)}</b> converts best: <span class="hi-good">${_fmtPct(_rowMetrics(best).crp)}</span> against an average of ${_fmtPct(t.crp)}.`);
    }
    const pr = rows.length >= 2 && overshoot < 0 ? rows.find((r) => r.name === problem) : null;
    if (pr) {
      const delta = _rowMetrics(pr).delta || 0;
      const change = delta < 0 ? `fell by ${_fmtCurrency(-delta)}` : delta > 0 ? `grew by only ${_fmtCurrency(delta)}` : "did not change";
      parts.push(`Revenue from <span class="hi-bad">${_esc(pr.name)}</span> ${change}, the furthest behind what its share of revenue would suggest.`);
    }
    if (key === "user_type" && rows.some((r) => r.name === "(not set)")) {
      parts.push("“(not set)” is a technical GA4 value: the visitor type could not be determined.");
    }
    return parts.join(" ");
  }

  function processSegments(d) {
    const cur = d.agg_current, pop = d.agg_pop, fc = d.funnel_current;
    const totals = {
      sessions: cur.sessions, s2: fc.view_item, s3: fc.add_to_cart, s4: fc.begin_checkout, s5: fc.purchase,
      revenue: cur.totalRevenue, transactions: cur.transactions, pop_revenue: pop.totalRevenue,
    };
    const p = {};
    Object.keys(SEG_PREFIX).forEach((k) => {
      const seg = (d.segments || {})[k];
      if (!seg) return;
      const rows = _rowsFor(k, seg);
      const table = _segmentTable(rows, totals);
      p[`SEG_${SEG_PREFIX[k]}_R`] = table.html;
      p[`SEG_${SEG_PREFIX[k]}_I`] = _segmentInsight(k, rows, totals, table.problem, table.overshoot);
    });
    p.SEG_EMPTY_STATE = "";
    return p;
  }

  // ── Summary for an LLM (copy to Claude) ──────────────────────────────────

  const SUMMARY_MAP = [
    ["REV", "Revenue"], ["AOV", "Average Order Value"], ["ARP", "ARPPC (revenue per purchaser)"],
    ["PUR", "Purchases (sessions with purchase)"], ["FST", "First-time purchasers"], ["RPT", "Repeat purchasers"],
    ["CON", "CR Sessions → Purchase"], ["CHP", "CR Checkout → Purchase"], ["CHK", "Sessions with Checkout"],
    ["ACK", "CR Add to Cart → Checkout"], ["ATS", "ATCs per Session"], ["ATC", "Sessions with Add to Cart"],
    ["PAC", "CR Product Views → Add to Cart"], ["PVC", "Sessions with Product Views"], ["SPV", "CR Sessions → Product Views"],
    ["PVS", "Product Views per Session"], ["SES", "Sessions"], ["SPU", "Sessions per User"],
  ];

  function mdTable(head, rows) {
    return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
  }

  function buildSummary(d, p, targetsInfo) {
    const out = [];
    out.push("## Dashboard data");
    out.push(`Store: ${d.store || "—"}. Period: ${d.period_label}. Compared with ${d.period_pop_label} (PoP)` +
      (d.yoy_available ? ` and the same period last year, ${d.period_yoy_label} (YoY).` : ". No data for the same period last year."));
    if (d.filters_label) out.push(`Filters applied to every number below: ${d.filters_label}.`);

    out.push("\n### Funnel metric map");
    const head = ["Metric", "Current", "Comparison period (PoP)", "Change"].concat(d.yoy_available ? ["Last year", "Change"] : []);
    out.push(mdTable(head, SUMMARY_MAP.map(([k, label]) => [label, p[`${k}_VAL`], p[`${k}_PP_P`] || "—", p[`${k}_PP_V`]]
      .concat(d.yoy_available ? [p[`${k}_YY_P`] || "—", p[`${k}_YY_V`]] : []))));

    const chans = [1, 2, 3, 4, 5, 6].filter((i) => p[`S${i}_N`]);
    if (chans.length) {
      out.push("\n### Traffic sources (sessions)");
      out.push(mdTable(["Channel", "Current", "Comparison period (PoP)", "Change"], chans.map((i) => [p[`S${i}_N`], p[`S${i}_VAL`], p[`S${i}_PP_P`] || "—", p[`S${i}_PP_V`]])));
    }

    out.push("\n### Driver tree: conversion steps vs targets");
    if (targetsInfo && targetsInfo.targets) {
      out.push(`Targets: ${targetsInfo.source === "manual" ? "chosen per step by the user (best month, 3-month average or own values)" : "each step's best month over the last 12 months"}.`);
      const tr = [["TR0", "Overall CR Sessions → Purchase", null], ["TR4", "Sessions → Product Views", "TA4"], ["TR3", "Product Views → Add to Cart", "TA3"], ["TR2", "Add to Cart → Checkout", "TA2"], ["TR1", "Checkout → Purchase", "TA1"]];
      out.push(mdTable(["Step", "Actual", "Target", "Gap", "Share of lost sessions"], tr.map(([k, label, ta]) => [label, p[`${k}_VAL`], p[`${k}_TG`], p[`${k}_GP`], ta ? p[`${ta}_LS`] : "—"])));
    } else {
      out.push("No targets set yet.");
    }

    const segNames = { user_type: "User type", traffic_source: "Traffic source", device: "Device", landing_page: "Landing page (top 5 + Other)" };
    const cur = d.agg_current, pop = d.agg_pop, fc = d.funnel_current;
    const totals = { name: "Total", sessions: cur.sessions, s2: fc.view_item, s3: fc.add_to_cart, s4: fc.begin_checkout, s5: fc.purchase,
      revenue: cur.totalRevenue, transactions: cur.transactions, pop_revenue: pop.totalRevenue };
    const segRow = (r) => {
      const m = _rowMetrics(r);
      return [r.name, _fmtInt(r.sessions), _fmtPct(m.cr1), _fmtPct(m.cr2), _fmtPct(m.cr3), _fmtPct(m.cr4), _fmtPct(m.crp),
        _fmtInt(r.s5), m.aov ? _fmtCurrency(m.aov) : "N/A", _fmtCurrency(r.revenue), _fmtDelta(m.delta)[0]];
    };
    Object.keys(segNames).forEach((k) => {
      const seg = (d.segments || {})[k];
      if (!seg || !seg.query_b_current.length) return;
      const rows = _rowsFor(k, seg);
      out.push(`\n### Segments: ${segNames[k]}`);
      out.push(mdTable(["Segment", "Sessions", "S→PV", "PV→ATC", "ATC→CHK", "CHK→PUR", "CR", "Purchases", "AOV", "Revenue", "Revenue vs previous"],
        rows.map(segRow).concat([segRow(totals)])));
    });

    const weeks = [...new Set((d.weekly_agg || []).map((r) => r.yearWeek))].sort();
    if (weeks.length) {
      const pur = {};
      (d.weekly_events || []).filter((r) => r.eventName === "purchase").forEach((r) => { pur[r.yearWeek] = r.sessions; });
      out.push("\n### Weekly trend (current period; first and last weeks may be partial)");
      out.push(mdTable(["Week (YYYYWW)", "Sessions", "Purchases", "Revenue", "CR"], weeks.map((w) => {
        const a = d.weekly_agg.find((r) => r.yearWeek === w) || {};
        return [w, _fmtInt(a.sessions), _fmtInt(pur[w] || 0), _fmtCurrency(a.totalRevenue), _fmtPct(_div(pur[w] || 0, a.sessions))];
      })));
    }

    const notes = [];
    const steps = [["view_item", "Product Views"], ["add_to_cart", "Add to Cart"], ["begin_checkout", "Checkout"], ["purchase", "Purchase"]];
    let prev = ["session_start", "Sessions"];
    steps.forEach(([e, label]) => {
      if ((fc[e] || 0) > (fc[prev[0]] || 0)) notes.push(`More sessions at ${label} (${_fmtInt(fc[e])}) than at ${prev[1]} (${_fmtInt(fc[prev[0]])}): likely platform behavior, shown as is.`);
      prev = [e, label];
    });
    if (cur.transactions > 0 && !cur.totalRevenue) notes.push("Transactions are recorded but revenue is zero: revenue may not be sent to GA4 with purchases.");
    if (notes.length) {
      out.push("\n### Data notes");
      notes.forEach((n) => out.push(`- ${n}`));
    }
    return out.join("\n");
  }

  // ── Template ───────────────────────────────────────────────────────────────

  function fillTemplate(template, placeholders) {
    let html = template;
    Object.keys(placeholders).forEach((k) => {
      if (k.startsWith("_")) return;
      html = html.split(`{{${k}}}`).join(String(placeholders[k]));
    });
    html = html.replace(/\{\{[A-Z0-9_]+\}\}/g, "");
    return html;
  }

  const api = { SEGMENT_DIMS, buildPeriods, requestPlan, chunk, reportRows, toGa4Data, processMap, buildVerdicts, autoTargets, targetOptions, processTree, processSegments, buildSummary, fillTemplate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.JMCore = api;
})(typeof window !== "undefined" ? window : globalThis);
