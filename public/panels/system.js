window.HUD = window.HUD || {};
HUD.system = (function() {
  'use strict';
  const $ = s => document.querySelector(s);

  function render(config) {
    const items = [
      ['DEFAULT MODEL', config.defaultModel || '—'],
      ['GATEWAY PORT', config.gateway?.port || '—'],
      ['GATEWAY MODE', config.gateway?.mode || '—'],
      ['GATEWAY BIND', config.gateway?.bind || '—'],
      ['MAX CONCURRENT', config.maxConcurrent || '—'],
      ['SPAWN DEPTH', config.subagents?.maxSpawnDepth || '—'],
      ['MAX CHILDREN', config.subagents?.maxChildren || '—'],
      ['CHANNELS', (config.channels || []).join(', ') || '—'],
      ['PROVIDERS', (config.providers || []).join(', ') || '—'],
    ];
    let html = items.map(([l,v]) =>
      `<div class="sys-row"><span class="sys-label">${escapeHtml(l)}</span><span class="sys-value">${escapeHtml(String(v))}</span></div>`
    ).join('');

    const aliases = config.modelAliases || {};
    const aliasEntries = Object.entries(aliases);
    if (aliasEntries.length > 0) {
      html += `<div class="sys-row" style="border-top:1px solid var(--border-dim);margin-top:8px;padding-top:8px;">
        <span class="sys-label" style="color:var(--magenta)">MODEL ALIASES</span></div>`;
      html += aliasEntries.map(([model, cfg]) => {
        const alias = (typeof cfg === 'object' && cfg.alias) ? cfg.alias : (typeof cfg === 'string' ? cfg : '?');
        return `<div class="sys-row"><span class="sys-label">${escapeHtml(alias)}</span><span class="sys-value" style="font-size:12px">${escapeHtml(model)}</span></div>`;
      }).join('');
    }

    $('#system-info').innerHTML = html;
    $('#sys-model').textContent = `MODEL: ${config.defaultModel || '?'}`;
  }

  return { render };
})();
