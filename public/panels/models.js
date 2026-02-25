window.HUD = window.HUD || {};
HUD.models = (function() {
  'use strict';
  const $ = s => document.querySelector(s);
  const COLOR_CLASSES = ['', 'alt1', 'alt2', 'alt3'];

  function escape(value) {
    if (typeof escapeHtml === 'function') return escapeHtml(value);
    if (value == null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function asNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  function formatTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  function normalizeRows(usage) {
    const payload = usage && typeof usage === 'object' ? usage : {};

    if (Array.isArray(payload.models)) {
      return {
        meta: payload.meta && typeof payload.meta === 'object' ? payload.meta : {},
        rows: payload.models,
      };
    }

    const hasContractShape = (
      Object.prototype.hasOwnProperty.call(payload, 'meta') ||
      Object.prototype.hasOwnProperty.call(payload, 'models') ||
      Object.prototype.hasOwnProperty.call(payload, 'totals')
    );

    if (hasContractShape) {
      return {
        meta: payload.meta && typeof payload.meta === 'object' ? payload.meta : {},
        rows: [],
      };
    }

    return {
      meta: {},
      rows: Object.entries(payload).map(function(entry) {
        const modelName = entry[0];
        const data = entry[1] && typeof entry[1] === 'object' ? entry[1] : {};
        return Object.assign({ model: modelName }, data);
      }),
    };
  }

  function render(usage) {
    const mount = $('#model-usage');
    if (!mount) return;

    const normalized = normalizeRows(usage);
    const meta = normalized.meta;
    const rows = normalized.rows
      .filter(function(row) {
        return row && typeof row === 'object';
      })
      .sort(function(a, b) {
        return asNumber(b.totalTokens) - asNumber(a.totalTokens);
      });

    const max = asNumber(rows[0]?.totalTokens) || 1;
    const periodLabel = `<div class="models-period-label" style="color:var(--text-dim);font-family:var(--font-mono);font-size:12px;margin-bottom:8px;">This week (Sun → now, ${escape(meta.tz || 'local')})</div>`;

    const body = rows.map(function(data, i) {
      const totalTokens = asNumber(data.totalTokens);
      const pct = Math.round((totalTokens / max) * 100);
      const modelName = data.model || data.id || '';
      const shortName = modelName.split('/').pop() || modelName;
      const colorClass = COLOR_CLASSES[i % COLOR_CLASSES.length];
      const inputTokens = asNumber(data.inputTokens);
      const outputTokens = asNumber(data.outputTokens);
      const cacheReadTokens = asNumber(data.cacheReadTokens);
      const totalCost = asNumber(data.totalCost);
      const agents = data.agents && typeof data.agents === 'object' ? data.agents : {};
      const agentBreakdown = Object.entries(agents)
        .sort(function(a, b) { return asNumber(b[1]?.totalTokens) - asNumber(a[1]?.totalTokens); })
        .map(function(entry) { return `${escape(entry[0])}:${formatTokens(asNumber(entry[1]?.totalTokens))}`; })
        .join(' · ');
      const costStr = totalCost > 0 ? ` · <span class="token-cost">$${totalCost.toFixed(2)}</span>` : '';
      const agentsHtml = agentBreakdown ? `<div class="model-agents">${agentBreakdown}</div>` : '';

      return `<div class="model-bar-row">
        <div class="model-bar-label"><span>${escape(shortName)}</span><span>${formatTokens(totalTokens)} tokens</span></div>
        <div class="model-bar-track"><div class="model-bar-fill ${colorClass}" style="width:${pct}%"></div></div>
        <div class="token-breakdown">IN: ${formatTokens(inputTokens)} · OUT: ${formatTokens(outputTokens)} · CACHE: ${formatTokens(cacheReadTokens)}${costStr}</div>
        ${agentsHtml}
      </div>`;
    }).join('');

    mount.innerHTML = periodLabel + (body || '<div style="color:var(--text-dim);font-family:var(--font-mono);font-size:13px;">No model data yet</div>');
  }

  return { render, formatTokens };
})();
