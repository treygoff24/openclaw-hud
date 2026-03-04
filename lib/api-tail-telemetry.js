const { performance } = require("node:perf_hooks");

const DEFAULT_SLOW_REQUEST_MS = 500;
const DEFAULT_SAMPLE_RATE = 0.2;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function clampToFiniteRange(value, min, max) {
  if (!isFiniteNumber(value)) return null;
  return Math.min(max, Math.max(min, value));
}

function parseSampleRate(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return DEFAULT_SAMPLE_RATE;
  return clampToFiniteRange(parsed, 0, 1);
}

function parseSlowThreshold(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_SLOW_REQUEST_MS;
  return parsed;
}

function clampText(value, maxLength) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (maxLength > 0 && trimmed.length > maxLength) return trimmed.slice(0, maxLength);
  return trimmed;
}

function isApiTailEndpoint(endpoint) {
  return typeof endpoint === "string" && endpoint.startsWith("/api/");
}

function parseCacheState(raw) {
  if (!raw || typeof raw !== "object") return null;

  return {
    state: raw.state && typeof raw.state === "string" ? raw.state : "disabled",
    cacheName: clampText(raw.cacheName, 128) || null,
    key: clampText(raw.key, 128) || null,
    ageMs: isFiniteNumber(raw.ageMs) ? Math.max(0, Math.floor(raw.ageMs)) : 0,
    ttlMs: isFiniteNumber(raw.ttlMs) ? Math.max(0, Math.floor(raw.ttlMs)) : 0,
  };
}

function parseHeaderCacheState(headerValue) {
  if (!headerValue || typeof headerValue !== "string") return null;

  try {
    return parseCacheState(JSON.parse(headerValue));
  } catch (_error) {
    return null;
  }
}

function parseIfNoneMatchHeader(rawHeader) {
  if (!rawHeader) return [];
  return String(rawHeader)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((value) => value.replace(/^W\//, ""));
}

function toMetric(value) {
  const n = Number(value);
  if (!isFiniteNumber(n)) return null;
  const safeValue = Math.max(0, n);
  return {
    count: 1,
    sum: safeValue,
    min: safeValue,
    max: safeValue,
    last: safeValue,
  };
}

function ensureApiTailEventSummary(event, metricName, fieldName, value) {
  if (!event.summary || typeof event.summary !== "object") {
    event.summary = {};
  }

  const metrics = event.summary;
  if (!metrics[metricName] || typeof metrics[metricName] !== "object") {
    metrics[metricName] = {};
  }

  const metric = toMetric(value);
  if (metric) {
    metrics[metricName][fieldName] = metric;
  }
}

function measureChunkBytes(chunk, encoding = "utf8") {
  if (chunk === undefined || chunk === null || typeof chunk === "function") return 0;
  if (Buffer.isBuffer(chunk)) return chunk.length;
  if (chunk instanceof ArrayBuffer) return chunk.byteLength;
  if (ArrayBuffer.isView(chunk)) return chunk.byteLength;
  const resolvedEncoding = typeof encoding === "string" ? encoding : "utf8";

  return Buffer.byteLength(String(chunk), resolvedEncoding);
}

function normalizeEndpoint(req) {
  const routePath = req.route?.path;
  const baseUrl = typeof req.baseUrl === "string" ? req.baseUrl : "";

  if (typeof routePath === "string" && routePath.length > 0) {
    if (baseUrl) {
      const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
      const normalizedRoutePath = routePath.startsWith("/") ? routePath : `/${routePath}`;
      return `${normalizedBaseUrl}${normalizedRoutePath}`;
    }
    return routePath;
  }

  const requestPath = typeof req.path === "string" ? req.path : "";
  if (baseUrl && requestPath.startsWith("/")) {
    const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    return `${normalizedBaseUrl}${requestPath}`;
  }
  return requestPath;
}

function normalizePhaseName(rawName) {
  if (typeof rawName !== "string") return null;
  const trimmed = rawName.trim();
  if (!trimmed) return null;
  if (trimmed.length > 64) return trimmed.slice(0, 64);
  return trimmed;
}

function emitApiTailTelemetryMetrics(event, metrics, counters) {
  const mergedMetrics = {};
  for (const source of [metrics, counters]) {
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    for (const [name, value] of Object.entries(source)) {
      mergedMetrics[name] = value;
    }
  }

  for (const [rawName, rawValue] of Object.entries(mergedMetrics)) {
    const metricName = normalizePhaseName(rawName);
    if (!metricName) continue;
    if (!isFiniteNumber(rawValue)) continue;

    ensureApiTailEventSummary(event, `apiTail.metric.${metricName}`, "count", rawValue);
  }
}

function buildQueueMsProxy(hints, req) {
  if (hints && isFiniteNumber(hints.queueMsProxy)) return Math.max(0, hints.queueMsProxy);

  const headerValue = req.get?.("x-queue-ms") || req.headers?.["x-queue-ms"];
  const parsedHeader = Number(headerValue);
  if (isFiniteNumber(parsedHeader) && parsedHeader >= 0) return parsedHeader;
  return 0;
}

function buildRequestId(req) {
  return (
    clampText(req.get?.("x-request-id"), 64) ||
    clampText(req.get?.("x-correlation-id"), 64) ||
    null
  );
}

function buildRunId(req) {
  return (
    clampText(req.get?.("x-run-id"), 128) ||
    clampText(req.get?.("x-openclaw-run-id"), 128) ||
    clampText(req.get?.("x-hud-run-id"), 128) ||
    (typeof req?.query?.runId === "string" ? clampText(req.query.runId, 128) : null) ||
    null
  );
}

function buildSource(req) {
  return (
    clampText(req.get?.("x-source"), 64) ||
    clampText(req.get?.("x-request-source"), 64) ||
    clampText(req.get?.("x-hud-source"), 64) ||
    null
  );
}

function hasEtagHit(req, statusCode, response) {
  if (Number(statusCode) !== 304) return false;
  const headerValue = req.get?.("if-none-match") || req.headers?.["if-none-match"];
  if (!headerValue) return false;

  const candidates = parseIfNoneMatchHeader(headerValue);
  if (candidates.length === 0) return false;

  const responseETag = response.getHeader("ETag");
  if (!responseETag) return true;

  const normalizedResponseETag = String(responseETag).replace(/^W\//, "");
  return candidates.includes(normalizedResponseETag);
}

function createDefaultOptions(options = {}) {
  return {
    sampleRate: parseSampleRate(
      typeof options.sampleRate === "undefined" ? process.env.HUD_API_TAIL_TELEMETRY_SAMPLE_RATE : options.sampleRate,
    ),
    slowRequestMs: parseSlowThreshold(
      typeof options.slowRequestMs === "undefined"
        ? process.env.HUD_API_TAIL_TELEMETRY_SLOW_MS
        : options.slowRequestMs,
    ),
    appendPerfEvents: options.appendPerfEvents || (async () => ({ accepted: 0 })),
    randomFn: typeof options.randomFn === "function" ? options.randomFn : Math.random,
  };
}

function shouldRecord(totalMs, slowRequestMs, sampleRate, randomFn) {
  if (!isFiniteNumber(totalMs)) return false;
  if (totalMs >= slowRequestMs) return true;
  if (!isFiniteNumber(sampleRate) || sampleRate <= 0) return false;
  if (sampleRate >= 1) return true;
  if (typeof randomFn !== "function") return Math.random() < sampleRate;
  return randomFn() < sampleRate;
}

function createApiTailTelemetryMiddleware(options = {}) {
  const opts = createDefaultOptions(options);

  return function apiTailTelemetryMiddleware(req, res, next) {
    const initialEndpoint = normalizeEndpoint(req);

    if (!isApiTailEndpoint(initialEndpoint) || initialEndpoint.startsWith("/api/diag/perf")) {
      return next();
    }

    const startedAtMs = performance.now();
    let bytesOut = 0;
    const originalEnd = res.end;
    const originalWrite = res.write;

    res.write = function patchedWrite(chunk, encoding, cb) {
      bytesOut += measureChunkBytes(chunk, encoding);
      return originalWrite.call(this, chunk, encoding, cb);
    };

    res.end = function patchedEnd(chunk, encoding, cb) {
      bytesOut += measureChunkBytes(chunk, encoding);
      return originalEnd.call(this, chunk, encoding, cb);
    };

    let didRecord = false;
    const onComplete = async () => {
      if (didRecord) return;
      didRecord = true;
      const endpoint = normalizeEndpoint(req);

      if (!isApiTailEndpoint(endpoint) || endpoint.startsWith("/api/diag/perf")) {
        return;
      }

      const totalMs = performance.now() - startedAtMs;
      if (!shouldRecord(totalMs, opts.slowRequestMs, opts.sampleRate, opts.randomFn)) return;

      const status = isFiniteNumber(res.statusCode) ? Number(res.statusCode) : 200;
      const queueMsProxy = buildQueueMsProxy(res.locals?.apiTailTelemetry, req);
      const hintWorkload = clampText(res.locals?.apiTailTelemetry?.workload, 128);
      const cacheState =
        (res.locals?.apiTailTelemetry?.cacheState && parseCacheState(res.locals.apiTailTelemetry.cacheState)) ||
        parseHeaderCacheState(res.getHeader?.("x-hud-cache-state")) ||
        {
          state: "disabled",
        };

      const event = {
        ts: new Date().toISOString(),
        endpoint,
        method: req?.method || "GET",
        status,
        requestId: buildRequestId(req),
        runId: buildRunId(req),
        source: buildSource(req),
        workload: hintWorkload,
        queueMsProxy,
        totalMs,
        bytesOut,
        etagHit: hasEtagHit(req, status, res),
        cacheState,
        summary: {},
      };

      const phases = res.locals?.apiTailTelemetry?.phases;
      ensureApiTailEventSummary(event, "apiTail.request", "status", status);
      ensureApiTailEventSummary(event, "apiTail.request", "totalMs", totalMs);
      ensureApiTailEventSummary(event, "apiTail.request", "queueMsProxy", queueMsProxy);
      ensureApiTailEventSummary(event, "apiTail.request", "bytesOut", bytesOut);
      ensureApiTailEventSummary(event, "apiTail.request", "etagHit", event.etagHit ? 1 : 0);

      ensureApiTailEventSummary(event, "apiTail.cache", "cacheHit", cacheState.state === "hit" ? 1 : 0);
      ensureApiTailEventSummary(event, "apiTail.cache", "cacheMiss", cacheState.state === "miss" ? 1 : 0);
      ensureApiTailEventSummary(event, "apiTail.cache", "cacheStale", cacheState.state === "stale" ? 1 : 0);
      ensureApiTailEventSummary(
        event,
        "apiTail.cache",
        "cacheDisabled",
        cacheState.state === "disabled" || cacheState.state == null ? 1 : 0,
      );

      if (phases && typeof phases === "object") {
        for (const [rawName, rawMs] of Object.entries(phases)) {
          const name = normalizePhaseName(rawName);
          if (!name) continue;
          ensureApiTailEventSummary(event, `apiTail.phase.${name}`, "durationMs", rawMs);
        }
      }

      emitApiTailTelemetryMetrics(
        event,
        res.locals?.apiTailTelemetry?.metrics,
        res.locals?.apiTailTelemetry?.counters,
      );

      try {
        await opts.appendPerfEvents([event]);
      } catch (_error) {
        // Telemetry errors must not affect API responses.
      }
    };

    res.once("finish", () => {
      void onComplete();
    });
    res.once("close", () => {
      void onComplete();
    });

    return next();
  };
}

module.exports = {
  createApiTailTelemetryMiddleware,
  DEFAULT_SLOW_REQUEST_MS,
  DEFAULT_SAMPLE_RATE,
  parseSampleRate,
  parseSlowThreshold,
};
