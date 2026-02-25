window.HUD = window.HUD || {};
HUD.models = (function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const COLOR_CLASSES = ["", "alt1", "alt2", "alt3"];

  function escape(value) {
    if (typeof escapeHtml === "function") return escapeHtml(value);
    if (value == null) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function asNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  function formatTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  }

  function formatCurrency(amount) {
    return `$${asNumber(amount).toFixed(2)}`;
  }

  function pickFirstFinite(values, fallback) {
    for (const value of values) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  }

  function getShortModelName(modelName) {
    const raw = String(modelName || "");
    if (!raw) return "";
    return raw.split("/").pop() || raw;
  }

  function getTopModelFromRows(rows) {
    const ranked = (Array.isArray(rows) ? rows : [])
      .filter(function (row) {
        return row && typeof row === "object";
      })
      .sort(function (a, b) {
        return asNumber(b.totalCost) - asNumber(a.totalCost);
      });
    if (ranked.length === 0) return null;
    const top = ranked[0];
    return {
      modelName: top.model || top.id || "",
      spend: asNumber(top.totalCost),
    };
  }

  function normalizeTopModel(topModel) {
    if (typeof topModel === "string") {
      return { modelName: topModel, spend: 0 };
    }

    if (!topModel || typeof topModel !== "object") return null;

    return {
      modelName:
        topModel.alias ||
        topModel.model ||
        topModel.id ||
        topModel.name ||
        topModel.modelName ||
        "",
      spend: pickFirstFinite(
        [topModel.totalCost, topModel.spend, topModel.cost, topModel.totalSpend],
        0,
      ),
    };
  }

  function buildUsageSummary(usagePayload, rows) {
    const payload = usagePayload && typeof usagePayload === "object" ? usagePayload : {};
    const payloadSummary =
      payload.summary && typeof payload.summary === "object" ? payload.summary : {};
    const weeklySpend = pickFirstFinite(
      [
        payloadSummary.weekSpend,
        payload?.totals?.totalCost,
        (Array.isArray(rows) ? rows : []).reduce(function (sum, row) {
          return sum + asNumber(row?.totalCost);
        }, 0),
      ],
      0,
    );

    const monthlySpend = pickFirstFinite(
      [
        payloadSummary.monthSpend,
        payload?.month?.totalCost,
        payload?.monthToDate?.totalCost,
        payload?.totals?.monthTotalCost,
        payload?.totals?.monthSpend,
        payload?.meta?.month?.totalCost,
        payload?.meta?.monthToDate?.totalCost,
        payload?.meta?.monthToDateCost,
        payload?.meta?.monthSpend,
      ],
      weeklySpend,
    );

    const explicitTop = normalizeTopModel(
      payloadSummary.topMonthModel ||
        payload?.month?.topModel ||
        payload?.monthToDate?.topModel ||
        payload?.meta?.topMonthModel ||
        payload?.meta?.monthTopModel,
    );
    const monthModels = Array.isArray(payload?.month?.models)
      ? payload.month.models
      : Array.isArray(payload?.monthToDate?.models)
        ? payload.monthToDate.models
        : [];
    const derivedTopFromMonthRows = getTopModelFromRows(monthModels);
    const derivedTopFromWeeklyRows = getTopModelFromRows(rows);
    const topModel = explicitTop || derivedTopFromMonthRows || derivedTopFromWeeklyRows;
    const topModelName = topModel?.modelName || "";
    const topModelSpend = pickFirstFinite([topModel?.spend], 0);
    const isMonthToDatePartial = Boolean(
      payload?.meta?.sessionsUsage?.monthToDate &&
      payload.meta.sessionsUsage.monthToDate.isPartial === true,
    );

    return {
      weeklySpend,
      monthlySpend,
      topModelName,
      topModelSpend,
      isMonthToDatePartial,
    };
  }

  function renderSummaryCards(summary) {
    const topModelDisplay = summary.topModelName
      ? `${getShortModelName(summary.topModelName)} · ${formatCurrency(summary.topModelSpend)}`
      : "—";

    const cards = [
      { label: "THIS WEEK SPEND", value: formatCurrency(summary.weeklySpend) },
      {
        label: summary.isMonthToDatePartial ? "THIS MONTH SPEND · PARTIAL" : "THIS MONTH SPEND",
        value: formatCurrency(summary.monthlySpend),
      },
      { label: "TOP MONTH MODEL", value: topModelDisplay },
    ];

    return `<div class="model-summary-grid">${cards
      .map(function (card) {
        return `<div class="model-summary-card">
          <div class="model-summary-label">${escape(card.label)}</div>
          <div class="model-summary-value">${escape(card.value)}</div>
        </div>`;
      })
      .join("")}</div>`;
  }

  function updateMonthlySpendStat(summary) {
    const statEl = $("#stat-monthly-spend");
    if (!statEl) return;
    statEl.textContent = formatCurrency(summary.monthlySpend);
  }

  function normalizeRows(usage) {
    const payload = usage && typeof usage === "object" ? usage : {};

    if (Array.isArray(payload.models)) {
      return {
        meta: payload.meta && typeof payload.meta === "object" ? payload.meta : {},
        rows: payload.models,
      };
    }

    const hasContractShape =
      Object.prototype.hasOwnProperty.call(payload, "meta") ||
      Object.prototype.hasOwnProperty.call(payload, "models") ||
      Object.prototype.hasOwnProperty.call(payload, "totals");

    if (hasContractShape) {
      return {
        meta: payload.meta && typeof payload.meta === "object" ? payload.meta : {},
        rows: [],
      };
    }

    return {
      meta: {},
      rows: Object.entries(payload).map(function (entry) {
        const modelName = entry[0];
        const data = entry[1] && typeof entry[1] === "object" ? entry[1] : {};
        return Object.assign({ model: modelName }, data);
      }),
    };
  }

  function getErrorDebugInfo(usage, responseMeta) {
    if (!usage || typeof usage !== "object" || usage.error == null) return null;

    const errorValue = usage.error;
    const errorObj = errorValue && typeof errorValue === "object" ? errorValue : {};
    const fallbackMeta = responseMeta && typeof responseMeta === "object" ? responseMeta : {};
    const fallbackUsageMeta = usage.meta && typeof usage.meta === "object" ? usage.meta : {};
    const status = usage.status || errorObj.status || fallbackMeta.status || "";
    const code = usage.code || errorObj.code || "";
    const message =
      usage.message ||
      errorObj.message ||
      (typeof errorValue === "string" ? errorValue : "") ||
      "Unknown error";
    const requestId =
      usage.requestId ||
      errorObj.requestId ||
      fallbackMeta.requestId ||
      fallbackUsageMeta.requestId ||
      "";
    const timestamp =
      usage.timestamp ||
      errorObj.timestamp ||
      fallbackMeta.timestamp ||
      fallbackUsageMeta.requestTimestamp ||
      "";

    return {
      status,
      code,
      message,
      requestId,
      timestamp,
    };
  }

  function renderErrorPanel(mount, debug) {
    const infoRows = [
      { label: "Status", value: debug.status || "n/a" },
      { label: "Code", value: debug.code || "n/a" },
      { label: "Message", value: debug.message || "n/a" },
      { label: "Request ID", value: debug.requestId || "n/a" },
      { label: "Timestamp", value: debug.timestamp || "n/a" },
    ];

    const body = infoRows
      .map(function (row) {
        return `<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:6px;">
        <div style="min-width:88px;color:var(--text-dim);font-family:var(--font-mono);font-size:12px;">${escape(row.label)}</div>
        <div style="color:var(--text);font-family:var(--font-mono);font-size:12px;word-break:break-word;">${escape(row.value)}</div>
      </div>`;
      })
      .join("");

    mount.innerHTML = `<div style="border:1px solid var(--line);border-radius:8px;padding:10px 12px;background:var(--panel-bg-alt, rgba(255,255,255,0.02));">
      <div style="color:var(--text);font-family:var(--font-mono);font-size:13px;margin-bottom:8px;">Model usage diagnostics</div>
      ${body}
    </div>`;
  }

  function render(usage, responseMeta) {
    const mount = $("#model-usage");
    if (!mount) return;

    const normalized = normalizeRows(usage);
    const sortedRows = normalized.rows
      .filter(function (row) {
        return row && typeof row === "object";
      })
      .sort(function (a, b) {
        return asNumber(b.totalTokens) - asNumber(a.totalTokens);
      });
    const summary = buildUsageSummary(usage, sortedRows);
    updateMonthlySpendStat(summary);

    const debug = getErrorDebugInfo(usage, responseMeta);
    if (debug) {
      renderErrorPanel(mount, debug);
      return;
    }

    const meta = normalized.meta;
    const rows = sortedRows;

    const max = asNumber(rows[0]?.totalTokens) || 1;
    const periodLabel = `<div class="models-period-label">This week (Sun → now, ${escape(meta.tz || "local")})</div>`;
    const summaryCards = renderSummaryCards(summary);

    const body = rows
      .map(function (data, i) {
        const totalTokens = asNumber(data.totalTokens);
        const pct = Math.round((totalTokens / max) * 100);
        const modelName = data.model || data.id || "";
        const shortName = modelName.split("/").pop() || modelName;
        const colorClass = COLOR_CLASSES[i % COLOR_CLASSES.length];
        const inputTokens = asNumber(data.inputTokens);
        const outputTokens = asNumber(data.outputTokens);
        const cacheReadTokens = asNumber(data.cacheReadTokens);
        const totalCost = asNumber(data.totalCost);
        const agents = data.agents && typeof data.agents === "object" ? data.agents : {};
        const agentBreakdown = Object.entries(agents)
          .sort(function (a, b) {
            return asNumber(b[1]?.totalTokens) - asNumber(a[1]?.totalTokens);
          })
          .map(function (entry) {
            return `${escape(entry[0])}:${formatTokens(asNumber(entry[1]?.totalTokens))}`;
          })
          .join(" · ");
        const costStr =
          totalCost > 0 ? ` · <span class="token-cost">$${totalCost.toFixed(2)}</span>` : "";
        const agentsHtml = agentBreakdown
          ? `<div class="model-agents">${agentBreakdown}</div>`
          : "";

        return `<div class="model-bar-row">
        <div class="model-bar-label"><span>${escape(shortName)}</span><span>${formatTokens(totalTokens)} tokens</span></div>
        <div class="model-bar-track"><div class="model-bar-fill ${colorClass}" style="width:${pct}%"></div></div>
        <div class="token-breakdown">IN: ${formatTokens(inputTokens)} · OUT: ${formatTokens(outputTokens)} · CACHE: ${formatTokens(cacheReadTokens)}${costStr}</div>
        ${agentsHtml}
      </div>`;
      })
      .join("");

    mount.innerHTML =
      periodLabel +
      summaryCards +
      (body ||
        '<div style="color:var(--text-dim);font-family:var(--font-mono);font-size:13px;">No model data yet</div>');
  }

  return { render, formatTokens };
})();
