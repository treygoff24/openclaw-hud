const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Router } = require("express");
const { OPENCLAW_HOME, safeReaddir, safeRead, getLiveWeekWindow } = require("../lib/helpers");
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

function buildLiveWeeklyResponsePayload({ usageRows, tz, liveWindow, nowMs, source, diagnostics }) {
  const normalizedRows = [];
  for (const row of Array.isArray(usageRows) ? usageRows : []) {
    const modelRow = normalizeModelRow(row);
    // The live-weekly contract intentionally omits rows without usage.
    if (modelRow.totalTokens <= 0) continue;
    normalizedRows.push(modelRow);
  }

  const pricingCatalog = loadPricingCatalog();
  const { rows: repricedRows, missingPricingModels } = repriceModelUsageRows(normalizedRows, {
    catalog: pricingCatalog,
  });

  const models = [];
  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    totalCost: 0,
  };

  for (const modelRow of repricedRows) {
    models.push(modelRow);
    totals.inputTokens += modelRow.inputTokens;
    totals.outputTokens += modelRow.outputTokens;
    totals.cacheReadTokens += modelRow.cacheReadTokens;
    totals.cacheWriteTokens += modelRow.cacheWriteTokens;
    totals.totalTokens += modelRow.totalTokens;
    totals.totalCost += modelRow.totalCost;
  }

  const meta = {
    period: "live-weekly",
    tz,
    weekStart: new Date(liveWindow.fromMs).toISOString(),
    now: new Date(liveWindow.toMs).toISOString(),
    generatedAt: new Date(nowMs).toISOString(),
    source,
    missingPricingModels,
    sessionsUsage: Object.assign({}, diagnostics),
  };

  return {
    meta,
    models,
    totals,
  };
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

  try {
    const payload = await requestSessionsUsage({
      from: liveWindow.fromMs,
      to: liveWindow.toMs,
      timezone: tz,
      limit: sessionsLimit,
    });
    const sessionsReturned = Array.isArray(payload?.result?.sessions)
      ? payload.result.sessions.length
      : null;
    const maybeTruncated = Number.isFinite(sessionsReturned) && sessionsReturned >= sessionsLimit;
    if (maybeTruncated) {
      console.warn("[model-usage/live-weekly] sessions.usage result may be truncated by limit", {
        sessionsReturned,
        sessionsLimit,
        requestId: requestContext.requestId,
      });
    }

    const responsePayload = buildLiveWeeklyResponsePayload({
      usageRows: collectUsageRows(payload),
      tz,
      liveWindow,
      nowMs,
      source: "sessions.usage+config-reprice",
      diagnostics: {
        sessionsLimit,
        sessionsReturned,
        sessionsMayBeTruncated: maybeTruncated,
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
