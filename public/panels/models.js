window.HUD = window.HUD || {};
HUD.models = (function() {
  'use strict';
  const $ = s => document.querySelector(s);
  const COLOR_CLASSES = ['', 'alt1', 'alt2', 'alt3'];

  function formatTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  function render(usage) {
    const entries = Object.entries(usage).sort((a,b) => b[1].totalTokens - a[1].totalTokens);
    const max = entries[0]?.[1]?.totalTokens || 1;

    $('#model-usage').innerHTML = entries.map(([model, data], i) => {
      const pct = Math.round((data.totalTokens / max) * 100);
      const shortName = model.split('/').pop();
      const colorClass = COLOR_CLASSES[i % COLOR_CLASSES.length];
      const agentBreakdown = Object.entries(data.agents || {})
        .sort((a,b) => b[1].totalTokens - a[1].totalTokens)
        .map(([a, d]) => `${escapeHtml(a)}:${formatTokens(d.totalTokens)}`)
        .join(' · ');
      const costStr = data.totalCost > 0 ? ` · <span class="token-cost">$${data.totalCost.toFixed(2)}</span>` : '';

      return `<div class="model-bar-row">
        <div class="model-bar-label"><span>${escapeHtml(shortName)}</span><span>${formatTokens(data.totalTokens)} tokens</span></div>
        <div class="model-bar-track"><div class="model-bar-fill ${colorClass}" style="width:${pct}%"></div></div>
        <div class="token-breakdown">IN: ${formatTokens(data.inputTokens)} · OUT: ${formatTokens(data.outputTokens)} · CACHE: ${formatTokens(data.cacheReadTokens)}${costStr}</div>
        <div class="model-agents">${agentBreakdown}</div>
      </div>`;
    }).join('') || '<div style="color:var(--text-dim);font-family:var(--font-mono);font-size:13px;">No model data yet</div>';
  }

  return { render, formatTokens };
})();
