const express = require("express");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");
const { setupWebSocket } = require("./ws/log-streaming");
const { GatewayWS } = require("./lib/gateway-ws");
const { getGatewayConfig } = require("./lib/helpers");
const { resolveGatewayInvokeBaseUrl } = require("./lib/gateway-http");
const { resolveMethodScopes } = require("./lib/gateway-compat/client");
const { applySecurityHeaders } = require("./lib/security-headers");
const { validateWsUpgradeRequest } = require("./lib/ws-origin-guard");
const healthRouter = require("./routes/health");
const spawnRouter = require("./routes/spawn");

const app = express();
const server = http.createServer(app);
const wsAuthToken = process.env.HUD_WS_AUTH_TOKEN || "";
const wss = new WebSocketServer({
  server,
  verifyClient: (info, done) => {
    const result = validateWsUpgradeRequest(info.req, { authToken: wsAuthToken });
    if (!result.ok) {
      console.warn("[ws] rejected inbound connection", {
        origin: info.req?.headers?.origin || null,
        remoteAddress: info.req?.socket?.remoteAddress || null,
      });
      done(false, result.statusCode || 403, result.message || "Forbidden");
      return;
    }
    done(true);
  },
});

const PORT = process.env.PORT || 3777;

process.env.HUD_USAGE_TZ = process.env.HUD_USAGE_TZ || "America/Chicago";
process.env.HUD_USAGE_CACHE_TTL_MS = process.env.HUD_USAGE_CACHE_TTL_MS || "60000";

app.disable("x-powered-by");
app.use(applySecurityHeaders());

function formatHostForUrl(host) {
  const normalized = String(host || "").trim();
  if (!normalized) return "127.0.0.1";
  if (normalized.toLowerCase() === "loopback") return "127.0.0.1";
  if (normalized.includes(":") && !normalized.startsWith("[")) return `[${normalized}]`;
  return normalized;
}

function normalizeUptimeMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function readGatewaySnapshotUptimeMs(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const candidates = [
    snapshot.uptimeMs,
    snapshot.gatewayUptimeMs,
    snapshot.system && snapshot.system.uptimeMs,
    snapshot.runtime && snapshot.runtime.uptimeMs,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeUptimeMs(candidate);
    if (normalized !== null) return normalized;
  }
  return null;
}

function dedupeScopes(scopes) {
  const seen = new Set();
  const out = [];
  for (const scope of scopes || []) {
    if (typeof scope !== "string") continue;
    const trimmed = scope.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

const SERVER_GATEWAY_METHOD_SCOPES = dedupeScopes(
  [
    "chat.history",
    "chat.send",
    "chat.abort",
    "models.list",
  ].flatMap((method) => resolveMethodScopes(method)),
);

const SPAWN_PRECHECK_TOOL_NAME = "sessions_spawn";
const SPAWN_PRECHECK_AGENT_ID = "__openclaw-hud-spawn-preflight-no-op__";
const SPAWN_PRECHECK_TASK_ID = "__openclaw-hud-spawn-preflight__";
const SPAWN_PRECHECK_TIMEOUT_MS = 8000;
const SPAWN_PRECHECK_TIMEOUT_SECONDS = 1;
const SPAWN_PRECHECK_BODY_SNIPPET_MAX_LENGTH = 512;

// Gateway WebSocket client
const gwConfig = getGatewayConfig();
const gatewayHost = gwConfig.host || gwConfig.bind || "127.0.0.1";
const gatewayWS = new GatewayWS({
  url: `ws://${formatHostForUrl(gatewayHost)}:${gwConfig.port || 18789}`,
  token: gwConfig.token,
  reconnect: { enabled: true, baseDelayMs: 1000, maxDelayMs: 30000, jitter: true },
  connect: {
    scopes: SERVER_GATEWAY_METHOD_SCOPES,
    role: "operator",
  },
});

function createGatewayStatusPayload(status) {
  const payload = { type: "gateway-status", status };
  if (status === "connected") {
    const uptimeMs = readGatewaySnapshotUptimeMs(gatewayWS.snapshot);
    if (uptimeMs !== null) {
      payload.uptimeMs = uptimeMs;
    }
  }
  return payload;
}

function parsePreflightBooleanFlag(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return false;
}

function readSpawnHardeningConfig() {
  return {
    allowlistOverride: parsePreflightBooleanFlag(process.env.OPENCLAW_SPAWN_ALLOWLIST_OVERRIDE),
    denylistOverride: parsePreflightBooleanFlag(process.env.OPENCLAW_SPAWN_DENYLIST_OVERRIDE),
  };
}

function createSpawnPreflightFailure(code, reason, diagnostics = []) {
  return {
    ok: false,
    enabled: false,
    code,
    status: "blocked",
    reason,
    diagnostics,
    checkedAt: Date.now(),
    source: "startup",
  };
}

function createSpawnPreflightSuccess() {
  return {
    ok: true,
    enabled: true,
    code: "READY",
    status: "ready",
    reason: "spawn preflight passed",
    diagnostics: [],
    checkedAt: Date.now(),
    source: "startup",
  };
}

function extractGatewayErrorMessage(body) {
  if (body?.error?.message) return String(body.error.message);
  if (body?.error) return String(body.error);
  if (typeof body?.message === "string") return body.message;
  return "Gateway returned an unknown error";
}

function extractGatewayErrorCode(body) {
  if (body?.error?.code) return String(body.error.code);
  if (body?.code) return String(body.code);
  return null;
}

function truncateBodySnippet(rawBody, maxLength = SPAWN_PRECHECK_BODY_SNIPPET_MAX_LENGTH) {
  if (typeof rawBody !== "string") return "";
  if (rawBody.length <= maxLength) return rawBody;
  return `${rawBody.slice(0, maxLength)}...`;
}

function parseJsonResponseBody(rawBody) {
  if (typeof rawBody !== "string" || !rawBody.trim()) return {};
  try {
    const parsed = JSON.parse(rawBody);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function getResponseContentType(response) {
  const headers = response?.headers;
  if (!headers || typeof headers !== "object") return null;
  if (typeof headers.get === "function") return headers.get("content-type");
  return headers["content-type"] || headers["Content-Type"] || null;
}

function createProbeFailureDiagnostic(response, rawBody, parsedErrorCode, message) {
  return {
    status: response?.status,
    statusText: response?.statusText || null,
    contentType: getResponseContentType(response),
    parsedErrorCode: parsedErrorCode || null,
    rawBodySnippet: truncateBodySnippet(String(rawBody || "")),
    message,
  };
}

function extractGatewayProbeMessage(body, response, rawBody) {
  const message = extractGatewayErrorMessage(body);
  if (message !== "Gateway returned an unknown error") return message;

  const status = Number.isFinite(Number(response?.status)) ? Number(response.status) : null;
  const statusText = typeof response?.statusText === "string" ? response.statusText.trim() : "";
  const snippet = truncateBodySnippet(String(rawBody || ""));

  if (status && statusText) return `${status} ${statusText}: ${snippet || "no body"}`;
  if (status) return `${status}: ${snippet || statusText || "unknown"}`;
  if (statusText) return statusText;
  if (snippet) return `Unknown gateway error body: ${snippet}`;
  return "Gateway returned an unknown error";
}

function createSpawnPreflightProbePayload() {
  return {
    tool: SPAWN_PRECHECK_TOOL_NAME,
    args: {
      // Using a non-existent agent id keeps the request side-effect free.
      // If the contract changes in the future, this probe must fail closed to avoid
      // enabling spawn when the result is uncertain.
      agentId: SPAWN_PRECHECK_AGENT_ID,
      task: `OpenClaw HUD startup spawn preflight probe: ${SPAWN_PRECHECK_TASK_ID}`,
      mode: "run",
      runTimeoutSeconds: SPAWN_PRECHECK_TIMEOUT_SECONDS,
    },
  };
}

function isSpawnProbePayloadSuccess(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.error !== undefined) return false;
  if (payload.ok === false) return false;
  if (payload.ok !== true) return false;
  const details =
    payload?.result?.details ||
    (payload?.result !== undefined && payload?.result !== null ? payload.result : undefined) ||
    payload?.details;

  // Fail closed on ambiguous payloads or if the gateway surfaced an inline error.
  if (details && typeof details === "object" && Object.prototype.hasOwnProperty.call(details, "error")) {
    return false;
  }

  // Protocol variants vary; only treat this as healthy when a structured result is present.
  return details !== undefined && typeof details === "object";
}

function hasSpawnProbeSideEffect(payload) {
  const details =
    payload?.result?.details ||
    (payload?.result !== undefined && payload?.result !== null ? payload.result : undefined) ||
    payload?.details;
  if (!details || typeof details !== "object") return false;
  if (typeof details.childSessionKey === "string" && details.childSessionKey.trim()) return true;
  if (typeof details.runId === "string" && details.runId.trim()) return true;
  if (typeof details.sessionKey === "string" && details.sessionKey.trim()) return true;
  if (typeof details.child_session_key === "string" && details.child_session_key.trim()) return true;
  if (typeof details.session_id === "string" && details.session_id.trim()) return true;
  if (typeof details.run_id === "string" && details.run_id.trim()) return true;
  if (typeof details.childSession === "string" && details.childSession.trim()) return true;
  return false;
}

function classifyToolProbeMessage(message, errorCode = null) {
  const lower = String(message || "").toLowerCase();
  if (!lower) return "GATEWAY_TOOL_INVOCATION_ERROR";
  if (typeof errorCode === "string" && /not.?found|unsupported|unknown/i.test(errorCode.toLowerCase())) return "SPAWN_TOOL_UNAVAILABLE";
  if (/not found|unknown|unsupported|method/i.test(lower)) return "SPAWN_TOOL_UNAVAILABLE";
  if (/allowlist|denylist|policy|blocked|forbidden/i.test(lower)) return "SPAWN_HARDENING_DENYLIST";
  return "GATEWAY_TOOL_INVOCATION_ERROR";
}

async function probeSpawnTool(gatewayConfig) {
  const baseUrl = resolveGatewayInvokeBaseUrl(gatewayConfig);
  const res = await fetch(`${baseUrl}/tools/invoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${gatewayConfig.token}`,
    },
    signal: AbortSignal.timeout(SPAWN_PRECHECK_TIMEOUT_MS),
    body: JSON.stringify(createSpawnPreflightProbePayload()),
  });

  const rawBody = await res.text().catch(() => "");
  const body = parseJsonResponseBody(rawBody);
  const parsedErrorCode = extractGatewayErrorCode(body);
  const message = extractGatewayProbeMessage(body, res, rawBody);
  const probeDiagnostic = createProbeFailureDiagnostic(res, rawBody, parsedErrorCode, message);
  if (res.ok) {
    if (hasSpawnProbeSideEffect(body)) {
      const sideEffectCode = "SPAWN_TOOL_INVOCATION_SIDE_EFFECT";
      return createSpawnPreflightFailure(sideEffectCode, "Probe payload returned session-like result data.", [
        {
          code: sideEffectCode,
          ...probeDiagnostic,
          message: message || "Probe invocation returned session-like payload.",
          remediation:
            "Do not trust startup compatibility probe when tool execution appears to persist sessions; keep spawn blocked.",
        },
      ]);
    }
    if (isSpawnProbePayloadSuccess(body)) {
      return createSpawnPreflightSuccess();
    }

    const code = classifyToolProbeMessage(message, parsedErrorCode);
    return createSpawnPreflightFailure(code, message, [
      {
        code,
        ...probeDiagnostic,
        message,
        remediation:
          code === "SPAWN_HARDENING_DENYLIST"
            ? "Check OpenClaw gateway tool allowlist/denylist policy override settings."
            : "Gateway accepted the probe request but did not return a successful result.",
      },
    ]);
  }
  const code = classifyToolProbeMessage(message, parsedErrorCode);
  return createSpawnPreflightFailure(code, message, [
    {
      code,
      ...probeDiagnostic,
      message,
      remediation: code === "SPAWN_TOOL_UNAVAILABLE"
        ? "Upgrade OpenClaw gateway to support sessions_spawn invoke compatibility."
        : "Verify gateway token, network access, and gateway readiness.",
    },
  ]);
}

async function runSpawnPreflight() {
  const gatewayConfig = getGatewayConfig();
  if (!gatewayConfig.token) {
    return createSpawnPreflightFailure("SPAWN_TOKEN_MISSING", "Gateway token is required for spawn invoke preflight", [
      {
        code: "SPAWN_TOKEN_MISSING",
        message: "Gateway token is required.",
        remediation: "Configure gateway token in gateway auth config.",
      },
    ]);
  }

  const hardening = readSpawnHardeningConfig();
  if (!hardening.allowlistOverride || !hardening.denylistOverride) {
    return createSpawnPreflightFailure("SPAWN_HARDENING_PRECHECK", "Allowlist/denylist override flags are required", [
      {
        code: "SPAWN_HARDENING_PRECHECK",
        message: "Missing required allowlist/denylist override configuration.",
        remediation:
          "Set OPENCLAW_SPAWN_ALLOWLIST_OVERRIDE=true and OPENCLAW_SPAWN_DENYLIST_OVERRIDE=true before enabling Spawn.",
      },
    ]);
  }

  try {
    return await probeSpawnTool(gatewayConfig);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Cannot contact gateway invoke endpoint for preflight";
    return createSpawnPreflightFailure("SPAWN_PRECHECK_NETWORK", message, [
      {
        code: "SPAWN_PRECHECK_NETWORK",
        message,
        remediation: "Ensure gateway invoke URL is reachable from HUD process.",
      },
    ]);
  }
}

function setSpawnPreflightState(state) {
  if (typeof spawnRouter.setSpawnPreflightState === "function") {
    spawnRouter.setSpawnPreflightState(state);
  }
}

function createSpawnPreflightLogPayload(state) {
  return {
    code: state.code,
    reason: state.reason,
    checkedAt: state.checkedAt,
    source: state.source,
    status: state.status,
    diagnostics: state.diagnostics,
  };
}

// Static files — vendor assets get long immutable cache, app files get short cache with ETag
// Vendor files: immutable, long cache (1 year)
app.use("/vendor", express.static(path.join(__dirname, "public", "vendor"), {
  maxAge: "1y",
  immutable: true,
  etag: true,
}));

// App files: short cache (5 minutes) with ETag for revalidation
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: "5m",
  etag: true,
}));

// Routes
healthRouter.setHealthStateProvider(() => {
  let websocketClients = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === 1) websocketClients += 1;
  });
  return {
    websocketClients,
    gatewayConnected: gatewayWS.connected,
  };
});
app.use(healthRouter);
app.use(require("./routes/config"));
app.use(require("./routes/agents"));
app.use(require("./routes/sessions"));
app.use(require("./routes/cron"));
app.use(spawnRouter);
app.use(require("./routes/model-usage"));
app.use(require("./routes/activity"));

function runStartupProbe() {
  return runSpawnPreflight()
    .then((state) => {
      setSpawnPreflightState(state);
      if (!state.ok) {
        console.warn("[spawn-preflight] blocked:", createSpawnPreflightLogPayload(state));
      } else {
        console.log("[spawn-preflight] passed:", state.code);
      }
      return state;
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      const failure = createSpawnPreflightFailure("SPAWN_PRECHECK_UNKNOWN", message, [
        {
          code: "SPAWN_PRECHECK_UNKNOWN",
          message,
          remediation: "Restart HUD after fixing gateway connectivity and configuration.",
        },
      ]);
      setSpawnPreflightState(failure);
      console.error("[spawn-preflight] failed:", message);
      return failure;
    });
}

if (require.main === module) {
  // WebSocket: push ticks every 10s
  function broadcastAll(data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach((c) => {
      if (c.readyState === 1) c.send(msg);
    });
  }
  wss.on("connection", (socket) => {
    if (socket.readyState !== 1) return;
    const status = gatewayWS.connected ? "connected" : "disconnected";
    socket.send(JSON.stringify(createGatewayStatusPayload(status)));
  });
  setInterval(() => broadcastAll({ type: "tick", timestamp: Date.now() }), 10000);

  // Gateway status broadcasts
  gatewayWS.on("connected", () => broadcastAll(createGatewayStatusPayload("connected")));
  gatewayWS.on("disconnected", () => broadcastAll(createGatewayStatusPayload("disconnected")));
  gatewayWS.on("error", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Gateway WS error:", message);
    broadcastAll(createGatewayStatusPayload("disconnected"));
  });

  runStartupProbe();
  // Connect (non-blocking)
  gatewayWS.connect().catch((err) => console.error("Gateway WS initial connect failed:", err));

  // WebSocket: log streaming + chat
  setupWebSocket(wss, gatewayWS);

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`\n  ╔════════════════════════════════╗`);
    console.log(`  ║  🔮 OPENCLAW HUD              ║`);
    console.log(`  ║  http://localhost:${PORT}        ║`);
    console.log(`  ╚════════════════════════════════╝\n`);
  });
}

module.exports = {
  isSpawnProbePayloadSuccess,
  createSpawnPreflightFailure,
  createSpawnPreflightSuccess,
  createSpawnPreflightProbePayload,
  extractGatewayErrorMessage,
  extractGatewayProbeMessage,
  extractGatewayErrorCode,
  truncateBodySnippet,
  createProbeFailureDiagnostic,
  getResponseContentType,
  parseJsonResponseBody,
  runStartupProbe,
  createSpawnPreflightLogPayload,
};
