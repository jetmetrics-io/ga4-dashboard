// App shell: scoped CSS + markup, mounted into <div id="jm-app">.
// Scoped under #jm-app so it survives inside a Tilda page.
// Header: row 1 = whose data + actions; row 2 = what slice (period first, then segment filters).

window.JMShell = {
  css: `
  #jm-app {
    --jm-bg: #F7F7F5; --jm-panel: #FFFFFF; --jm-sub: #F6F6F4; --jm-line: #E3E3E0; --jm-line2: #EFEFEC;
    --jm-text: #1A1A1A; --jm-ink2: #4A4A4A; --jm-muted: #8A8A8A; --jm-faint: #B4B4B1;
    --jm-accent: #0E9C7D; --jm-accent-ink: #0B8169; --jm-accent-weak: #E8F5F1; --jm-accent-line: #A9DCCD;
    --jm-error: #D64545; --jm-error-weak: #FDEEEE; --jm-warn: #E0A100; --jm-warn-weak: #FFF6E5; --jm-warn-ink: #8A5A00;
    position: relative; background: var(--jm-panel); color: var(--jm-text);
    font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  #jm-app * { box-sizing: border-box; }
  #jm-app button, #jm-app input { font: inherit; color: inherit; margin: 0; text-transform: none; letter-spacing: normal; }
  #jm-app button { cursor: pointer; }
  #jm-app button:focus-visible, #jm-app input:focus-visible, #jm-app [role="button"]:focus-visible { outline: 2px solid var(--jm-accent); outline-offset: 2px; }
  #jm-app [hidden] { display: none !important; }

  #jm-app .jm-head { position: relative; background: var(--jm-panel); border-bottom: 1px solid var(--jm-line); }
  #jm-app .jm-row { display: flex; align-items: center; gap: 10px; padding: 0 20px; min-width: 0; }
  #jm-app .jm-main { min-height: 68px; padding-top: 12px; padding-bottom: 12px; flex-wrap: wrap; row-gap: 10px; }
  #jm-app .jm-grow { flex: 1 1 auto; }
  #jm-app .jm-brand { display: flex; flex-direction: column; line-height: 1.15; margin-right: 10px; white-space: nowrap; }
  #jm-app .jm-logo { font-weight: 700; font-size: 18px; letter-spacing: -0.2px; }
  #jm-app .jm-logo b { color: var(--jm-accent); font-weight: 700; }
  #jm-app .jm-prod { color: var(--jm-muted); font-size: 13px; margin-top: 2px; }

  #jm-app .jm-btn { display: inline-flex; align-items: center; gap: 7px; height: 36px; padding: 0 12px; border: 1px solid var(--jm-line); background: var(--jm-panel); border-radius: 8px; white-space: nowrap; line-height: 1.2; }
  #jm-app .jm-btn:hover { border-color: #CFCFCB; }
  #jm-app .jm-btn:disabled { opacity: .5; cursor: default; }
  #jm-app .jm-icon { width: 36px; padding: 0; justify-content: center; color: var(--jm-ink2); border-color: transparent; background: transparent; }
  #jm-app .jm-icon:hover { background: var(--jm-sub); }
  #jm-app .jm-claude svg { color: var(--jm-accent); }
  #jm-app .jm-chev { color: var(--jm-faint); flex: none; }

  /* Data: the main action */
  #jm-app .jm-data { height: 44px; padding: 0 14px 0 12px; gap: 10px; background: var(--jm-accent-weak); border: 1.5px solid var(--jm-accent); text-align: left; }
  #jm-app .jm-data:hover { border-color: var(--jm-accent-ink); }
  #jm-app .jm-stack { display: inline-flex; flex-direction: column; align-items: flex-start; }
  #jm-app .jm-k { font-size: 11px; color: var(--jm-muted); line-height: 1.1; }
  #jm-app .jm-v { font-weight: 600; font-size: 15px; line-height: 1.25; max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
  #jm-app .jm-ga { position: relative; width: 26px; height: 26px; border-radius: 7px; background: var(--jm-panel); display: grid; place-items: center; color: var(--jm-accent); box-shadow: inset 0 0 0 1px var(--jm-accent-line); }
  #jm-app .jm-ga::after { content: ""; position: absolute; right: -2px; bottom: -2px; width: 8px; height: 8px; border-radius: 50%; background: var(--jm-accent); border: 2px solid var(--jm-accent-weak); }
  #jm-app .jm-data.jm-solid { background: var(--jm-accent); border-color: var(--jm-accent); color: #fff; padding: 0 18px 0 12px; }
  #jm-app .jm-data.jm-solid:hover { background: var(--jm-accent-ink); }
  #jm-app .jm-data.jm-solid .jm-k { color: rgba(255,255,255,.8); }
  #jm-app .jm-data.jm-solid .jm-ga { background: rgba(255,255,255,.18); color: #fff; box-shadow: none; }
  #jm-app .jm-data.jm-solid .jm-ga::after { display: none; }
  #jm-app .jm-data.jm-solid .jm-chev { color: rgba(255,255,255,.8); }

  /* Filter row: period first, then segment filters */
  #jm-app .jm-fbar { min-height: 46px; padding-top: 7px; padding-bottom: 7px; background: var(--jm-sub); border-top: 1px solid var(--jm-line2); flex-wrap: wrap; gap: 8px; }
  #jm-app .jm-chips { display: contents; }
  #jm-app .jm-chip { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px 0 12px; border-radius: 999px; border: 1px solid var(--jm-line); background: var(--jm-panel); font-size: 13px; color: var(--jm-ink2); white-space: nowrap; line-height: 1.2; }
  #jm-app .jm-chip:hover { border-color: #CFCFCB; }
  #jm-app .jm-chip b { font-weight: 500; color: var(--jm-text); max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
  #jm-app .jm-chip.jm-on { background: var(--jm-accent-weak); border-color: var(--jm-accent-line); color: var(--jm-accent-ink); cursor: pointer; }
  #jm-app .jm-chip.jm-on b { color: var(--jm-accent-ink); }
  #jm-app .jm-x { display: grid; place-items: center; width: 18px; height: 18px; border: 0; border-radius: 50%; background: none; padding: 0; color: var(--jm-accent-ink); }
  #jm-app .jm-x:hover { background: rgba(14,156,125,.15); }
  #jm-app .jm-period { gap: 8px; color: var(--jm-text); border-color: #D6D6D2; font-variant-numeric: tabular-nums; }
  #jm-app .jm-period .jm-cal { color: var(--jm-muted); display: inline-flex; }
  #jm-app .jm-period .jm-p1 { font-weight: 500; }
  #jm-app .jm-period .jm-vs { color: var(--jm-faint); font-size: 12.5px; }
  #jm-app .jm-period .jm-p2 { color: var(--jm-ink2); }
  #jm-app .jm-fsep { width: 1px; height: 20px; background: var(--jm-line); margin: 0 4px; }
  #jm-app .jm-clear { border: 0; background: none; color: var(--jm-muted); font-size: 12.5px; padding: 0 4px; }
  #jm-app .jm-clear:hover { color: var(--jm-text); }

  /* Loading line and one message area */
  #jm-app .jm-progress { position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; overflow: hidden; }
  #jm-app .jm-progress::after { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 30%; background: var(--jm-accent); }
  @media (prefers-reduced-motion: no-preference) { #jm-app .jm-progress::after { animation: jm-run 1.1s ease-in-out infinite; } }
  @keyframes jm-run { from { left: -30%; } to { left: 100%; } }
  #jm-app .jm-msg { display: flex; align-items: center; gap: 12px; padding: 10px 20px; font-size: 13px; border-bottom: 1px solid var(--jm-line); background: var(--jm-sub); color: var(--jm-ink2); }
  #jm-app .jm-msg.jm-warn { background: var(--jm-warn-weak); color: var(--jm-warn-ink); }
  #jm-app .jm-msg.jm-error { background: var(--jm-error-weak); color: var(--jm-error); }
  #jm-app .jm-msg.jm-ok { background: var(--jm-accent-weak); color: var(--jm-accent-ink); }
  #jm-app .jm-msg-act { margin-left: auto; display: flex; gap: 14px; }
  #jm-app .jm-msg-act a, #jm-app .jm-msg-act button { color: var(--jm-accent-ink); font-weight: 500; text-decoration: none; background: none; border: 0; padding: 0; }
  #jm-app .jm-msg.jm-error .jm-msg-act button { color: var(--jm-error); text-decoration: underline; }

  /* Dark button: Apply in menus */
  #jm-app .jm-dark { background: var(--jm-text); border-color: var(--jm-text); color: #fff; }
  #jm-app .jm-dark:hover { background: #000; border-color: #000; }

  /* Before the first dashboard */
  #jm-app .jm-empty { padding: 64px 24px 72px; text-align: center; }
  #jm-app .jm-empty h2 { font-size: 22px; font-weight: 600; margin: 0 0 8px; letter-spacing: -0.2px; }
  #jm-app .jm-empty p { color: var(--jm-muted); margin: 0 auto; max-width: 52ch; line-height: 1.55; }
  /* First visit: what the product is and how it treats data (also the app homepage for Google) */
  #jm-app .jm-intro { max-width: 860px; margin: 28px auto 0; text-align: left; }
  #jm-app .jm-feats { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
  #jm-app .jm-feat { border: 1px solid var(--jm-line); border-radius: 10px; padding: 14px 16px; background: var(--jm-panel); }
  #jm-app .jm-feat b { display: block; font-weight: 600; margin-bottom: 4px; }
  #jm-app .jm-feat span { display: block; color: var(--jm-ink2); font-size: 13px; line-height: 1.5; }
  #jm-app .jm-data-note { margin-top: 16px; padding: 14px 16px; border-radius: 10px; background: var(--jm-sub); color: var(--jm-ink2); font-size: 13px; line-height: 1.55; }
  #jm-app .jm-data-note b { color: var(--jm-text); }
  #jm-app .jm-data-note a, #jm-app .jm-footer a { color: var(--jm-accent-ink); }
  #jm-app .jm-intro-cta { margin-top: 20px; text-align: center; }
  #jm-app .jm-cta { height: 42px; padding: 0 20px; background: var(--jm-accent); border-color: var(--jm-accent); color: #fff; font-weight: 600; }
  #jm-app .jm-cta:hover { background: var(--jm-accent-ink); border-color: var(--jm-accent-ink); }
  /* Footer on every state: product, privacy policy, contact */
  #jm-app .jm-footer { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 18px; padding: 16px 20px 20px; border-top: 1px solid var(--jm-line2); font-size: 12.5px; color: var(--jm-muted); }

  #jm-app .jm-stage { display: flex; justify-content: center; }
  #jm-app iframe { display: block; width: 100%; height: 600px; border: 0; background: var(--jm-panel); transition: opacity .2s; }
  #jm-app.jm-loading iframe { opacity: .45; }

  /* Menus */
  #jm-app .jm-menu { position: fixed; z-index: 2147483000; min-width: 260px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow-y: auto; background: var(--jm-panel); border: 1px solid var(--jm-line); border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.12); padding: 6px; font-size: 14px; }
  #jm-app .jm-mh { font-size: 11.5px; color: var(--jm-muted); padding: 6px 10px 4px; }
  #jm-app .jm-it { display: flex; width: 100%; align-items: baseline; gap: 10px; border: 0; background: none; text-align: left; padding: 8px 10px; border-radius: 6px; line-height: 1.3; }
  #jm-app .jm-it:hover { background: var(--jm-sub); }
  #jm-app .jm-it.jm-sel { background: var(--jm-accent-weak); color: var(--jm-accent-ink); font-weight: 600; }
  #jm-app .jm-md { margin-left: auto; color: var(--jm-muted); font-size: 12.5px; font-weight: 400; font-variant-numeric: tabular-nums; white-space: nowrap; }
  #jm-app .jm-it .jm-sub { color: var(--jm-muted); font-size: 12px; font-weight: 400; }
  #jm-app .jm-menu hr { border: 0; border-top: 1px solid var(--jm-line2); margin: 4px 0; }
  #jm-app .jm-danger { color: var(--jm-error); }
  #jm-app label.jm-it { align-items: center; cursor: pointer; }
  #jm-app label.jm-it input { accent-color: var(--jm-accent); flex: none; }
  #jm-app label.jm-it span:first-of-type { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #jm-app .jm-bulk { display: flex; gap: 14px; padding: 2px 10px 6px; }
  #jm-app .jm-bulk button { border: 0; background: none; padding: 0; color: var(--jm-accent-ink); font-size: 12.5px; }
  #jm-app .jm-bulk button:hover { text-decoration: underline; }
  #jm-app .jm-search { display: block; width: calc(100% - 12px); margin: 4px 6px 6px; height: 32px; border: 1px solid var(--jm-line); border-radius: 6px; padding: 0 10px; font-size: 13px; }
  #jm-app .jm-opts { max-height: 320px; overflow-y: auto; }
  #jm-app .jm-acts { display: flex; gap: 8px; padding: 8px 6px 4px; border-top: 1px solid var(--jm-line2); margin-top: 4px; }
  #jm-app .jm-acts .jm-btn { height: 32px; }

  /* Period panel: pairs of period and its usual comparison; nothing applies until Apply */
  #jm-app .jm-menu.jm-dates { width: 720px; padding: 8px; }
  #jm-app .jm-pair { display: grid; grid-template-columns: 1fr 1fr; column-gap: 8px; }
  #jm-app .jm-pair > * + * { border-left: 1px solid var(--jm-line2); padding-left: 8px; }
  #jm-app .jm-ct { display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 600; padding: 6px 10px; }
  #jm-app .jm-follow { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font-weight: 400; color: var(--jm-muted); cursor: pointer; }
  #jm-app .jm-follow input { accent-color: var(--jm-accent); }
  #jm-app .jm-plist { border-top: 1px solid var(--jm-line2); border-bottom: 1px solid var(--jm-line2); padding: 2px 0; }
  #jm-app .jm-gsep { height: 8px; }
  #jm-app .jm-pair .jm-it { padding-top: 6px; padding-bottom: 6px; }
  #jm-app .jm-pair .jm-it .jm-md { font-size: 12px; color: var(--jm-faint); }
  #jm-app .jm-pair .jm-it.jm-sel .jm-md { color: var(--jm-accent-ink); opacity: .75; }
  #jm-app .jm-range { display: flex; align-items: center; gap: 6px; padding: 8px 10px; }
  #jm-app .jm-range span { color: var(--jm-faint); }
  #jm-app .jm-range input { flex: 1; min-width: 0; height: 32px; border: 1px solid var(--jm-line); border-radius: 6px; padding: 0 8px; font-size: 13px; color: var(--jm-ink2); background: var(--jm-panel); }
  #jm-app .jm-foot { display: flex; align-items: center; gap: 8px; margin-top: 6px; padding: 10px 6px 4px 10px; border-top: 1px solid var(--jm-line2); }
  #jm-app .jm-sum { flex: 1; display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 8px; row-gap: 2px; font-size: 12.5px; color: var(--jm-muted); font-variant-numeric: tabular-nums; }
  #jm-app .jm-sum span { white-space: nowrap; }
  #jm-app .jm-sum span + span::before { content: "·"; color: var(--jm-faint); margin-right: 8px; }
  #jm-app .jm-sum b { color: var(--jm-text); font-weight: 500; }
  #jm-app .jm-foot .jm-btn { height: 34px; }

  @media (max-width: 760px) {
    #jm-app .jm-menu.jm-dates .jm-pair { grid-template-columns: 1fr; }
    #jm-app .jm-menu.jm-dates .jm-pair > * + * { border-left: 0; padding-left: 0; }
  }
  `,

  icons: {
    chev: '<svg class="jm-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    more: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><circle cx="12.5" cy="8" r="1.4" fill="currentColor"/></svg>',
    spark: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6Z" fill="currentColor"/></svg>',
    bars: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="8" width="3" height="6" rx="1.2" fill="currentColor"/><rect x="6.5" y="5" width="3" height="9" rx="1.2" fill="currentColor"/><rect x="11" y="2" width="3" height="12" rx="1.2" fill="currentColor"/></svg>',
    cal: '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    x: '<svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2 8 8M8 2 2 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  },

  html() {
    const I = this.icons;
    return `
  <div class="jm-head">
    <div class="jm-row jm-main">
      <div class="jm-brand"><span class="jm-logo">Jet<b>Metrics</b></span><span class="jm-prod">Funnel Dashboard</span></div>
      <button id="dataBtn" class="jm-btn jm-data jm-solid" disabled>
        <span class="jm-ga">${I.bars}</span>
        <span class="jm-stack"><span class="jm-k" id="dataK">Your data</span><span class="jm-v" id="dataV">Connect Google Analytics</span></span>
        <span id="dataChev" hidden>${I.chev}</span>
      </button>
      <span class="jm-grow"></span>
      <button id="copyClaude" class="jm-btn jm-claude" hidden title="Copy our analysis brief and this dashboard's data, then paste into a new Claude chat">${I.spark}Copy for Claude</button>
      <button id="moreBtn" class="jm-btn jm-icon" hidden aria-label="More" data-menu="more">${I.more}</button>
    </div>
    <div class="jm-row jm-fbar" id="fbar" hidden>
      <button id="periodBtn" class="jm-chip jm-period" data-menu="dates" aria-label="Period and comparison"></button>
      <span class="jm-fsep"></span>
      <span id="chips" class="jm-chips"></span>
    </div>
    <div class="jm-progress" id="progress" hidden></div>
  </div>
  <div id="msg" class="jm-msg" hidden><span id="msgText"></span><span class="jm-msg-act" id="msgAct"></span></div>
  <div id="empty" class="jm-empty">
    <h2 id="emptyTitle">See your GA4 funnel from traffic to revenue</h2>
    <p id="emptyText">Connect Google Analytics with the green button above and pick your store. Reports go from Google straight to this browser; we don't store your data.</p>
    <div id="intro" class="jm-intro">
      <div class="jm-feats">
        <div class="jm-feat"><b>Funnel metric map</b><span>Traffic, product views, cart, checkout, purchases and revenue on one map, compared with the previous period and last year.</span></div>
        <div class="jm-feat"><b>Conversion driver tree</b><span>Overall conversion split into four funnel steps, each against its target, with what-if modeling.</span></div>
        <div class="jm-feat"><b>Segments and filters</b><span>The funnel by user type, traffic source, device and landing page. Every cut also works as a filter.</span></div>
        <div class="jm-feat"><b>Copy for Claude</b><span>The dashboard's numbers with our analysis brief, ready to paste into a Claude chat.</span></div>
      </div>
      <div class="jm-data-note"><b>Your data.</b> JetMetrics Funnel Dashboard asks Google for read-only access to your Google Analytics data and for your email address. It uses them only to list your GA4 properties and build this dashboard for the period you choose. Reports go from Google straight to your browser and are shown only to you: JetMetrics doesn't receive, store or share them. Disconnect at any time. <a href="/privacy">Privacy policy</a></div>
      <div class="jm-intro-cta"><button class="jm-btn jm-cta" data-act="connect">Connect Google Analytics</button></div>
    </div>
  </div>
  <div class="jm-stage"><iframe id="frame" title="Dashboard" hidden></iframe></div>
  <div class="jm-footer"><span>JetMetrics Funnel Dashboard</span><a href="/privacy">Privacy policy</a><a href="mailto:mary@jetmetrics.io">mary@jetmetrics.io</a></div>
  <div id="jmMenu" class="jm-menu" hidden></div>
  `;
  },

  mount() {
    const root = document.getElementById("jm-app");
    if (!root || root.dataset.mounted) return;
    const style = document.createElement("style");
    style.textContent = this.css;
    document.head.appendChild(style);
    root.innerHTML = this.html();
    root.dataset.mounted = "1";
  },
};
