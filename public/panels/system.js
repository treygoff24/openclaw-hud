window.HUD = window.HUD || {};
HUD.system = (function () {
  "use strict";
  const $ = (s) => document.querySelector(s);

  function sanitizeConfig(config) {
    return config && typeof config === "object" ? config : {};
  }

  function renderPlainValue(value) {
    return `<span class="sys-value">${escapeHtml(String(value || "—"))}</span>`;
  }

  function renderTagValue(values) {
    const tags = (Array.isArray(values) ? values : [])
      .map(function (value) {
        return String(value || "").trim();
      })
      .filter(Boolean);

    if (tags.length === 0) return renderPlainValue("—");

    return `<span class="sys-value"><span class="sys-tag-list">${tags
      .map(function (tag) {
        return `<span class="sys-tag">${escapeHtml(tag)}</span>`;
      })
      .join("")}</span></span>`;
  }

  function render(config) {
    const cfg = sanitizeConfig(config);
    const items = [
      { label: "DEFAULT MODEL", value: cfg.defaultModel || "—" },
      { label: "GATEWAY PORT", value: cfg.gateway?.port || "—" },
      { label: "GATEWAY MODE", value: cfg.gateway?.mode || "—" },
      { label: "GATEWAY BIND", value: cfg.gateway?.bind || "—" },
      { label: "MAX CONCURRENT", value: cfg.maxConcurrent || "—" },
      { label: "SPAWN DEPTH", value: cfg.subagents?.maxSpawnDepth || "—" },
      { label: "MAX CHILDREN", value: cfg.subagents?.maxChildren || "—" },
      { label: "CHANNELS", value: cfg.channels, format: "tags" },
      { label: "PROVIDERS", value: cfg.providers, format: "tags" },
    ];
    let html = items
      .map(function (item) {
        const valueHtml =
          item.format === "tags" ? renderTagValue(item.value) : renderPlainValue(item.value);
        return `<div class="sys-row"><span class="sys-label">${escapeHtml(item.label)}</span>${valueHtml}</div>`;
      })
      .join("");

    const aliases = cfg.modelAliases || {};
    const aliasEntries = Object.entries(aliases);
    if (aliasEntries.length > 0) {
      html += `<div class="sys-row" style="border-top:1px solid var(--border-dim);margin-top:8px;padding-top:8px;">
        <span class="sys-label" style="color:var(--magenta)">MODEL ALIASES</span></div>`;
      html += aliasEntries
        .map(([model, cfg]) => {
          const alias =
            typeof cfg === "object" && cfg.alias ? cfg.alias : typeof cfg === "string" ? cfg : "?";
          return `<div class="sys-row"><span class="sys-label">${escapeHtml(alias)}</span><span class="sys-value sys-value-alias">${escapeHtml(model)}</span></div>`;
        })
        .join("");
    }

    $("#system-info").innerHTML = html;
    $("#sys-model").textContent = `MODEL: ${cfg.defaultModel || "?"}`;
  }

  return { render };
})();
