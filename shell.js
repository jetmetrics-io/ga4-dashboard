// App shell: scoped CSS + markup, mounted into <div id="jm-app">.
// Scoped under #jm-app so it survives inside a Tilda page.

window.JMShell = {
  css: `
  #jm-app {
    --jm-bg: #F7F7F5; --jm-panel: #FFFFFF; --jm-text: #1A1A1A; --jm-muted: #888888;
    --jm-line: #E8E8E5; --jm-accent: #0E9C7D; --jm-error: #D64545;
    background: var(--jm-bg); color: var(--jm-text);
    font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  #jm-app * { box-sizing: border-box; }
  #jm-app .jm-bar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 12px 16px; background: var(--jm-panel); border-bottom: 1px solid var(--jm-line); }
  #jm-app .jm-brand { font-weight: 700; margin-right: 8px; }
  #jm-app .jm-brand span { color: var(--jm-accent); }
  #jm-app select, #jm-app button { font: inherit; padding: 7px 10px; border: 1px solid var(--jm-line); border-radius: 8px; background: var(--jm-panel); color: var(--jm-text); margin: 0; }
  #jm-app select { max-width: 360px; }
  #jm-app button { cursor: pointer; }
  #jm-app button.primary { background: var(--jm-accent); border-color: var(--jm-accent); color: #fff; }
  #jm-app button.connected { background: var(--jm-panel); color: var(--jm-accent); border-color: var(--jm-accent); }
  #jm-app button:disabled, #jm-app select:disabled { opacity: 0.5; cursor: default; }
  #jm-app .status { flex-basis: 100%; font-size: 12px; color: var(--jm-muted); }
  #jm-app .status.ok { color: var(--jm-accent); }
  #jm-app .status.error { color: var(--jm-error); }
  #jm-app .targets { flex-basis: 100%; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px 16px; padding: 12px; border: 1px solid var(--jm-line); border-radius: 10px; background: var(--jm-bg); }
  #jm-app .targets[hidden] { display: none; }
  #jm-app .targets-title { grid-column: 1 / -1; font-weight: 600; }
  #jm-app .targets label { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; }
  #jm-app .targets input { width: 80px; font: inherit; padding: 5px 8px; border: 1px solid var(--jm-line); border-radius: 6px; }
  #jm-app .targets-actions { grid-column: 1 / -1; display: flex; gap: 8px; }
  #jm-app .targets-note { grid-column: 1 / -1; font-size: 12px; color: var(--jm-muted); }
  #jm-app .jm-stage { display: flex; justify-content: center; padding: 16px; }
  #jm-app iframe { width: 100%; max-width: 980px; height: 600px; border: 0; background: var(--jm-panel); border-radius: 12px; }
  `,

  html: `
  <div class="jm-bar">
    <div class="jm-brand">Jet<span>Metrics</span> · Funnel Dashboard</div>
    <button id="connect" class="primary" disabled>Connect Google Analytics</button>
    <select id="property" disabled><option>Property</option></select>
    <select id="period" disabled>
      <option value="last28">Last 28 days</option>
      <option value="lastMonth">Last month</option>
      <option value="thisMonth">This month</option>
    </select>
    <button id="refresh" disabled>Refresh</button>
    <button id="targetsBtn" disabled>Targets</button>
    <button id="download" disabled title="Download the raw GA4 data used for this dashboard">Raw data</button>
    <div id="targets" class="targets" hidden>
      <div class="targets-title">Funnel targets for the Driver Tree</div>
      <label>Sessions → Product Views <input id="t_s_pv" type="number" step="0.1" min="0"> %</label>
      <label>Product Views → Add to Cart <input id="t_pv_atc" type="number" step="0.1" min="0"> %</label>
      <label>Add to Cart → Checkout <input id="t_atc_chk" type="number" step="0.1" min="0"> %</label>
      <label>Checkout → Purchase <input id="t_chk_pur" type="number" step="0.1" min="0"> %</label>
      <div class="targets-actions"><button id="targetsSave" class="primary">Save my targets</button><button id="targetsAuto">Use automatic</button></div>
      <div id="targetsNote" class="targets-note"></div>
    </div>
    <div id="status" class="status">Connect your Google Analytics account to start. Your data goes from Google straight to this browser.</div>
  </div>
  <div class="jm-stage"><iframe id="frame" title="Dashboard"></iframe></div>
  `,

  mount() {
    const root = document.getElementById("jm-app");
    if (!root || root.dataset.mounted) return;
    const style = document.createElement("style");
    style.textContent = this.css;
    document.head.appendChild(style);
    root.innerHTML = this.html;
    root.dataset.mounted = "1";
  },
};
