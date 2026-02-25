const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { performance } = require("perf_hooks");
const { Router } = require("express");
const {
  OPENCLAW_HOME,
  safeReaddir,
  safeRead,
  getLiveWeekWindow,
  getTimezoneParts,
  timezoneWallToUtcMs,
  getModelAliasMap,
} = require("../lib/helpers");
const { requestSessionsUsage } = require("../lib/usage-rpc");
const {
  getPricingConfigFingerprint,
  loadPricingCatalog,
  repriceModelUsageRows,
} = require("../lib/pricing");
const { readWeeklyHistory, readWeeklySnapshot } = require("../lib/usage-archive");
const { normalizeModelRow, collectUsageRows } = require("../lib/usage-normalize");

const router = Router();

let liveWeeklyCache = null;
const DEFAULT_USAGE_SESSIONS_LIMIT = 500;
const MIN_USAGE_SESSIONS_LIMIT = 1;
const MAX_USAGE_SESSIONS_LIMIT = 2000;
const DEFAULT_MONTH_USAGE_MAX_WINDOWS = 30;
const MIN_MONTH_USAGE_MAX_WINDOWS = 2;
const MAX_MONTH_USAGE_MAX_WINDOWS = 120;
const DEFAULT_MONTH_USAGE_MAX_DURATION_MS = 7000;
const MIN_MONTH_USAGE_MAX_DURATION_MS = 100;
const MAX_MONTH_USAGE_MAX_DURATION_MS = 120000;

function getUsageCacheTtlMs() {
  const ttlMs = Number(process.env.HUD_USAGE_CACHE_TTL_MS);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return 0;
  return ttlMs;
}

function getUsageSessionsLimit() {
  const rawLimit = Number.parseInt(process.env.HUD_USAGE_SESSIONS_LIMIT, 10);
  const parsedLimit = Number.isFinite(rawLimit) ? rawLimit : DEFAULT_USAGE_SESSIONS_LIMIT;
  if (parsedLimit < MIN_USAGE_SESSIONS_LIMIT) return MIN_USAGE_SESSIONS_LIMIT;
  if (parsedLimit > MAX_USAGE_SESSIONS_LIMIT) return MAX_USAGE_SESSIONS_LIMIT;
  return parsedLimit;
}

function getMonthUsageMaxWindows() {
  const rawLimit = Number.parseInt(process.env.HUD_USAGE_MONTH_MAX_WINDOWS, 10);
  const parsedLimit = Number.isFinite(rawLimit) ? rawLimit : DEFAULT_MONTH_USAGE_MAX_WINDOWS;
  if (parsedLimit < MIN_MONTH_USAGE_MAX_WINDOWS) return MIN_MONTH_USAGE_MAX_WINDOWS;
  if (parsedLimit > MAX_MONTH_USAGE_MAX_WINDOWS) return MAX_MONTH_USAGE_MAX_WINDOWS;
  return parsedLimit;
}

function getMonthUsageMaxDurationMs() {
  const rawDuration = Number.parseInt(process.env.HUD_USAGE_MONTH_MAX_DURATION_MS, 10);
  const parsedDuration = Number.isFinite(rawDuration)
    ? rawDuration
    : DEFAULT_MONTH_USAGE_MAX_DURATION_MS;
  if (parsedDuration < MIN_MONTH_USAGE_MAX_DURATION_MS) return MIN_MONTH_USAGE_MAX_DURATION_MS;
  if (parsedDuration > MAX_MONTH_USAGE_MAX_DURATION_MS) return MAX_MONTH_USAGE_MAX_DURATION_MS;
  return parsedDuration;
}

function shouldRefreshLiveWeekly(req) {
  const refresh = req?.query?.refresh;
  return refresh === "1" || refresh === 1 || refresh === true;
}

function getLiveWeeklyCacheKey({ tz, pricingFingerprint, sessionsLimit }) {
  return `${tz}|${pricingFingerprint}|${sessionsLimit}`;
}

function createRequestContext(req, nowMs) {
  const headerRequestId = req?.get?.("x-request-id") || req?.headers?.["x-request-id"];
  const headerCorrelationId = req?.get?.("x-correlation-id") || req?.headers?.["x-correlation-id"];
  const generatedRequestId = crypto.randomBytes(8).toString("hex");
  const requestId = String(headerRequestId || headerCorrelationId || generatedRequestId).trim();
  return {
    requestId,
    requestTimestamp: new Date(nowMs).toISOString(),
  };
}

function addRequestContextToMeta(payload, requestContext) {
  if (!payload || typeof payload !== "object") return payload;
  const meta = payload.meta && typeof payload.meta === "object" ? payload.meta : {};
  return Object.assign({}, payload, {
    meta: Object.assign({}, meta, {
      requestId: requestContext.requestId,
      requestTimestamp: requestContext.requestTimestamp,
    }),
  });
}

function makeLinePreview(line) {
  const normalized = String(line || "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= 120) return normalized;
  return `${normalized.slice(0, 117)}...`;
}

function createTimezoneFormatter(timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hour12: false,
  });
}

function getLiveMonthWindow(tz = "America/Chicago", nowMs = Date.now()) {
  const timeZone = typeof tz === "string" && tz.trim().length > 0 ? tz : "America/Chicago";
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const formatter = createTimezoneFormatter(timeZone);
  const nowParts = getTimezoneParts(formatter, now);
  const monthStartWall = {
    year: nowParts.year,
    month: nowParts.month,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  };
  const monthStartMs = timezoneWallToUtcMs(formatter, timeZone, monthStartWall);
  return { fromMs: monthStartMs, toMs: now };
}

function normalizeUsageRows(rows) {
  const normalizedRows = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const modelRow = normalizeModelRow(row);
    // The live-weekly contract intentionally omits rows without usage.
    if (modelRow.totalTokens <= 0) continue;
    normalizedRows.push(modelRow);
  }
  return normalizedRows;
}

function aggregateUsageRowsByModel(normalizedRows) {
  const byModel = new Map();
  for (const row of Array.isArray(normalizedRows) ? normalizedRows : []) {
    const key = `${row.provider}::${row.model}`;
    if (!byModel.has(key)) {
      byModel.set(key, {
        provider: row.provider,
        model: row.model,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        totalCost: 0,
      });
    }
    const aggregate = byModel.get(key);
    aggregate.inputTokens += row.inputTokens;
    aggregate.outputTokens += row.outputTokens;
    aggregate.cacheReadTokens += row.cacheReadTokens;
    aggregate.cacheWriteTokens += row.cacheWriteTokens;
    aggregate.totalTokens += row.totalTokens;
  }
  return [...byModel.values()];
}

function buildUsageBreakdown(normalizedRows, pricingCatalog) {
  const { rows: repricedRows, missingPricingModels } = repriceModelUsageRows(normalizedRows, {
    catalog: pricingCatalog,
  });

  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    totalCost: 0,
  };

  for (const modelRow of repricedRows) {
    totals.inputTokens += modelRow.inputTokens;
    totals.outputTokens += modelRow.outputTokens;
    totals.cacheReadTokens += modelRow.cacheReadTokens;
    totals.cacheWriteTokens += modelRow.cacheWriteTokens;
    totals.totalTokens += modelRow.totalTokens;
    totals.totalCost += modelRow.totalCost;
  }

  return {
    models: repricedRows,
    totals,
    missingPricingModels,
  };
}

function buildLiveWeeklyResponsePayload({
  weeklyBreakdown,
  summary,
  tz,
  liveWindow,
  nowMs,
  source,
  diagnostics,
}) {
  const meta = {
    period: "live-weekly",
    tz,
    weekStart: new Date(liveWindow.fromMs).toISOString(),
    now: new Date(liveWindow.toMs).toISOString(),
    generatedAt: new Date(nowMs).toISOString(),
    source,
    missingPricingModels: weeklyBreakdown.missingPricingModels,
    sessionsUsage: Object.assign({}, diagnostics),
  };

  return {
    meta,
    models: weeklyBreakdown.models,
    totals: weeklyBreakdown.totals,
    summary,
  };
}

function resolveModelAlias(modelId, aliasMap) {
  const model = typeof modelId === "string" ? modelId.trim() : "";
  if (!model) return "unknown";
  const config = aliasMap && typeof aliasMap === "object" ? aliasMap[model] : null;
  if (typeof config === "string" && config.trim()) return config.trim();
  if (
    config &&
    typeof config === "object" &&
    typeof config.alias === "string" &&
    config.alias.trim()
  ) {
    return config.alias.trim();
  }
  const shortName = model.split("/").pop();
  return shortName || model;
}

function getTopMonthModel(monthModels, aliasMap) {
  let topModel = null;
  for (const row of Array.isArray(monthModels) ? monthModels : []) {
    if (!topModel || row.totalCost > topModel.totalCost) {
      topModel = row;
    }
  }
  if (!topModel) return null;
  return {
    model: topModel.model,
    alias: resolveModelAlias(topModel.model, aliasMap),
    totalCost: topModel.totalCost,
  };
}

function buildLiveWeeklySummary({ weeklyTotals, monthTotals, monthModels, aliasMap }) {
  return {
    weekSpend: Number(weeklyTotals?.totalCost) || 0,
    monthSpend: Number(monthTotals?.totalCost) || 0,
    topMonthModel: getTopMonthModel(monthModels, aliasMap),
  };
}

function splitWindowByUtcDay({ fromMs, toMs }) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return [];

  const fromDayStart = new Date(fromMs);
  fromDayStart.setUTCHours(0, 0, 0, 0);
  const toDayStart = new Date(toMs);
  toDayStart.setUTCHours(0, 0, 0, 0);
  if (fromDayStart.getTime() === toDayStart.getTime()) return [];

  const windows = [];
  let windowStart = fromMs;
  const cursor = new Date(fromDayStart.getTime());
  cursor.setUTCDate(cursor.getUTCDate() + 1);

  while (cursor.getTime() <= toMs) {
    const boundary = cursor.getTime();
    windows.push({ fromMs: windowStart, toMs: boundary - 1 });
    windowStart = boundary;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  if (windowStart <= toMs) windows.push({ fromMs: windowStart, toMs });
  return windows.length > 1 ? windows : [];
}

async function requestUsageWindow({ window, tz, sessionsLimit }) {
  const payload = await requestSessionsUsage({
    from: window.fromMs,
    to: window.toMs,
    timezone: tz,
    limit: sessionsLimit,
  });
  const sessionsReturned = Array.isArray(payload?.result?.sessions)
    ? payload.result.sessions.length
    : null;
  return {
    usageRows: collectUsageRows(payload),
    sessionsReturned,
    sessionsMayBeTruncated:
      Number.isFinite(sessionsReturned) &&
      Number.isFinite(sessionsLimit) &&
      sessionsReturned >= sessionsLimit,
  };
}

async function collectMonthToDateUsageRows({ monthWindow, tz, sessionsLimit, requestId }) {
  const pendingWindows = [monthWindow];
  const usageRows = [];
  const maxWindows = getMonthUsageMaxWindows();
  const maxDurationMs = getMonthUsageMaxDurationMs();
  const startedAtMs = performance.now();
  const partialReasons = [];
  let coverageFromMs = null;
  let coverageToMs = null;
  let windowsRequested = 0;
  let windowsSplit = 0;
  let truncatedWindows = 0;
  let truncatedSingleDayWindows = 0;

  const addPartialReason = (reason) => {
    if (!partialReasons.includes(reason)) partialReasons.push(reason);
  };

  while (pendingWindows.length > 0) {
    const elapsedMs = performance.now() - startedAtMs;
    if (elapsedMs >= maxDurationMs) {
      addPartialReason("time-budget-exhausted");
      console.warn("[model-usage/live-weekly] month usage collection reached duration guardrail", {
        elapsedMs,
        maxDurationMs,
        windowsRequested,
        pendingWindows: pendingWindows.length,
        sessionsLimit,
        requestId,
      });
      break;
    }
    if (windowsRequested >= maxWindows) {
      addPartialReason("window-budget-exhausted");
      console.warn("[model-usage/live-weekly] month usage collection reached call guardrail", {
        maxWindows,
        windowsRequested,
        pendingWindows: pendingWindows.length,
        sessionsLimit,
        requestId,
      });
      break;
    }

    const window = pendingWindows.shift();
    windowsRequested += 1;
    const windowUsage = await requestUsageWindow({ window, tz, sessionsLimit });

    if (windowUsage.sessionsMayBeTruncated) {
      truncatedWindows += 1;
      const splitWindows = splitWindowByUtcDay(window);
      if (splitWindows.length > 1) {
        windowsSplit += splitWindows.length;
        console.warn(
          "[model-usage/live-weekly] month usage window may be truncated; splitting by UTC day",
          {
            from: new Date(window.fromMs).toISOString(),
            to: new Date(window.toMs).toISOString(),
            splitCount: splitWindows.length,
            sessionsLimit,
            requestId,
          },
        );
        pendingWindows.unshift(...splitWindows);
        continue;
      }
      truncatedSingleDayWindows += 1;
      addPartialReason("single-day-window-truncated");
      console.warn(
        "[model-usage/live-weekly] month usage single-day window may still be truncated",
        {
          from: new Date(window.fromMs).toISOString(),
          to: new Date(window.toMs).toISOString(),
          sessionsLimit,
          requestId,
        },
      );
    }

    if (coverageFromMs == null || window.fromMs < coverageFromMs) coverageFromMs = window.fromMs;
    if (coverageToMs == null || window.toMs > coverageToMs) coverageToMs = window.toMs;
    usageRows.push(...windowUsage.usageRows);
  }

  const diagnostics = {
    isPartial: partialReasons.length > 0,
    partialReason: partialReasons[0] || null,
    partialReasons,
    windowsRequested,
    windowsSplit,
    windowsRemaining: pendingWindows.length,
    truncatedWindows,
    truncatedSingleDayWindows,
    coverage: {
      from: Number.isFinite(coverageFromMs) ? new Date(coverageFromMs).toISOString() : null,
      to: Number.isFinite(coverageToMs) ? new Date(coverageToMs).toISOString() : null,
    },
    guardrails: {
      maxWindows,
      maxDurationMs,
    },
  };

  return { usageRows, diagnostics };
}

function maybeStoreLiveWeeklyCache({ ttlMs, nowMs, cacheKey, payload }) {
  if (ttlMs > 0) {
    liveWeeklyCache = {
      cacheKey,
      expiresAtMs: nowMs + ttlMs,
      payload,
    };
  } else {
    liveWeeklyCache = null;
  }
}

function buildUnavailableLiveWeeklyPayload({ tz, liveWindow, nowMs, reason, requestContext }) {
  return {
    meta: {
      period: "live-weekly",
      tz,
      weekStart: new Date(liveWindow.fromMs).toISOString(),
      now: new Date(liveWindow.toMs).toISOString(),
      generatedAt: new Date(nowMs).toISOString(),
      requestId: requestContext.requestId,
      requestTimestamp: requestContext.requestTimestamp,
      source: "sessions.usage+config-reprice",
      missingPricingModels: [],
      unavailable: reason,
    },
    models: [],
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      totalCost: 0,
    },
    summary: {
      weekSpend: 0,
      monthSpend: 0,
      topMonthModel: null,
    },
  };
}

router.get("/api/model-usage", (req, res) => {
  const agentsDir = path.join(OPENCLAW_HOME, "agents");
  const agents = safeReaddir(agentsDir);
  const usage = {};

  const ensure = (model) => {
    if (!usage[model])
      usage[model] = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        agents: {},
      };
  };
  const ensureAgent = (model, agentId) => {
    if (!usage[model].agents[agentId])
      usage[model].agents[agentId] = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  };

  for (const agentId of agents) {
    const sessDir = path.join(agentsDir, agentId, "sessions");
    const files = safeReaddir(sessDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        try {
          return { name: f, mtime: fs.statSync(path.join(sessDir, f)).mtimeMs };
        } catch (err) {
          console.warn("[model-usage] session file stat failed", {
            agentId,
            file: f,
            message: err?.message || "Unknown stat error",
          });
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 10)
      .map((f) => f.name);

    for (const file of files) {
      const raw = safeRead(path.join(sessDir, file));
      if (!raw) continue;

      let currentModel = null;
      for (const line of raw.split("\n").filter(Boolean)) {
        try {
          const e = JSON.parse(line);
          if (e.type === "model_change" && e.modelId) {
            currentModel = e.modelId;
          }
          if (e.type === "message" && e.message?.usage) {
            const u = e.message.usage;
            const model = e.message.model || currentModel || "unknown";
            ensure(model);
            ensureAgent(model, agentId);
            const inp = u.input || 0;
            const out = u.output || 0;
            const cr = u.cacheRead || 0;
            const cw = u.cacheWrite || 0;
            const tot = u.totalTokens || inp + out + cr + cw;
            const cost = u.cost?.total || 0;
            usage[model].inputTokens += inp;
            usage[model].outputTokens += out;
            usage[model].cacheReadTokens += cr;
            usage[model].cacheWriteTokens += cw;
            usage[model].totalTokens += tot;
            usage[model].totalCost += cost;
            usage[model].agents[agentId].inputTokens += inp;
            usage[model].agents[agentId].outputTokens += out;
            usage[model].agents[agentId].totalTokens += tot;
          }
        } catch (err) {
          console.warn("[model-usage] session jsonl parse failed", {
            agentId,
            file,
            linePreview: makeLinePreview(line),
            message: err?.message || "Unknown parse error",
          });
        }
      }
    }
  }

  res.json(usage);
});

router.get("/api/model-usage/history", (req, res) => {
  const weekStart = typeof req.query?.weekStart === "string" ? req.query.weekStart.trim() : "";

  if (weekStart) {
    try {
      const snapshot = readWeeklySnapshot(weekStart);
      if (!snapshot) {
        return res
          .status(404)
          .json({ error: `No archived usage snapshot found for weekStart=${weekStart}` });
      }
      return res.json({ snapshot });
    } catch (error) {
      return res.status(400).json({ error: `Invalid weekStart query parameter: ${error.message}` });
    }
  }

  const snapshots = readWeeklyHistory();
  return res.json({ snapshots });
});

router.get("/api/model-usage/live-weekly", async (req, res) => {
  const tz = process.env.HUD_USAGE_TZ || "America/Chicago";
  const nowMs = Date.now();
  const requestContext = createRequestContext(req, nowMs);
  const ttlMs = getUsageCacheTtlMs();
  const sessionsLimit = getUsageSessionsLimit();
  const refresh = shouldRefreshLiveWeekly(req);
  const pricingFingerprint = getPricingConfigFingerprint();
  const cacheKey = getLiveWeeklyCacheKey({ tz, pricingFingerprint, sessionsLimit });

  if (
    !refresh &&
    liveWeeklyCache &&
    nowMs < liveWeeklyCache.expiresAtMs &&
    liveWeeklyCache.cacheKey === cacheKey
  ) {
    return res.json(addRequestContextToMeta(liveWeeklyCache.payload, requestContext));
  }

  const liveWindow = getLiveWeekWindow(tz, nowMs);
  const monthWindow = getLiveMonthWindow(tz, nowMs);

  try {
    const weeklyWindowUsage = await requestUsageWindow({
      window: liveWindow,
      tz,
      sessionsLimit,
    });
    const maybeTruncated = weeklyWindowUsage.sessionsMayBeTruncated;
    if (maybeTruncated) {
      console.warn("[model-usage/live-weekly] sessions.usage result may be truncated by limit", {
        sessionsReturned: weeklyWindowUsage.sessionsReturned,
        sessionsLimit,
        requestId: requestContext.requestId,
      });
    }

    const pricingCatalog = loadPricingCatalog();
    const weeklyBreakdown = buildUsageBreakdown(
      normalizeUsageRows(weeklyWindowUsage.usageRows),
      pricingCatalog,
    );

    const monthCollection = await collectMonthToDateUsageRows({
      monthWindow,
      tz,
      sessionsLimit,
      requestId: requestContext.requestId,
    });
    const monthBreakdown = buildUsageBreakdown(
      aggregateUsageRowsByModel(normalizeUsageRows(monthCollection.usageRows)),
      pricingCatalog,
    );
    const modelAliases = getModelAliasMap();
    const summary = buildLiveWeeklySummary({
      weeklyTotals: weeklyBreakdown.totals,
      monthTotals: monthBreakdown.totals,
      monthModels: monthBreakdown.models,
      aliasMap: modelAliases,
    });

    const responsePayload = buildLiveWeeklyResponsePayload({
      weeklyBreakdown,
      summary,
      tz,
      liveWindow,
      nowMs,
      source: "sessions.usage+config-reprice",
      diagnostics: {
        sessionsLimit,
        sessionsReturned: weeklyWindowUsage.sessionsReturned,
        sessionsMayBeTruncated: maybeTruncated,
        monthToDate: monthCollection.diagnostics,
      },
    });

    maybeStoreLiveWeeklyCache({ ttlMs, nowMs, cacheKey, payload: responsePayload });

    res.json(addRequestContextToMeta(responsePayload, requestContext));
  } catch (err) {
    const unavailableReasonByCode = {
      GATEWAY_TOKEN_MISSING: "gateway-token-missing",
      GATEWAY_HOST_UNSUPPORTED: "gateway-host-unsupported",
      GATEWAY_UNREACHABLE: "gateway-unreachable",
    };
    const unavailableReason = unavailableReasonByCode[err?.code];
    if (unavailableReason) {
      console.warn("[model-usage/live-weekly] gateway unavailable", {
        reason: unavailableReason,
        code: err?.code || null,
        gatewayCode: err?.gatewayCode || null,
        gatewayMethod: err?.gatewayMethod || null,
        message: err?.message || "Unknown error",
        requestId: requestContext.requestId,
      });
      return res.json(
        buildUnavailableLiveWeeklyPayload({
          tz,
          liveWindow,
          nowMs,
          reason: unavailableReason,
          requestContext,
        }),
      );
    }

    if (err?.message === "Gateway token not configured") {
      console.warn("[model-usage/live-weekly] gateway unavailable", {
        reason: "gateway-token-missing",
        code: err?.code || null,
        gatewayCode: err?.gatewayCode || null,
        gatewayMethod: err?.gatewayMethod || null,
        message: err?.message || "Unknown error",
        requestId: requestContext.requestId,
      });
      return res.json(
        buildUnavailableLiveWeeklyPayload({
          tz,
          liveWindow,
          nowMs,
          reason: "gateway-token-missing",
          requestContext,
        }),
      );
    }

    const status = Number(err?.status || err?.statusCode) || 502;
    const code = err?.code || "MODEL_USAGE_LIVE_WEEKLY_ERROR";
    const message = err?.message || "Unknown error";
    const timestamp = new Date().toISOString();
    console.error("[model-usage/live-weekly] failed", {
      status,
      code,
      message,
      requestId: requestContext.requestId,
    });

    res.status(status).json({
      error: "Failed to load live weekly usage",
      message,
      code,
      status,
      requestId: requestContext.requestId,
      timestamp,
    });
  }
});

module.exports = router;
