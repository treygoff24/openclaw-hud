const express = require("express");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");
const { setupWebSocket } = require("./ws/log-streaming");
const { GatewayWS } = require("./lib/gateway-ws");
const { getGatewayConfig } = require("./lib/helpers");
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

async function runSpawnPreflight() {
  try {
    const gatewayConfig = getGatewayConfig();
    if (!gatewayConfig.token) {
      return createSpawnPreflightFailure(
        "SPAWN_TOKEN_MISSING",
        "Gateway token is required for spawn invoke preflight",
        [
          {
            code: "SPAWN_TOKEN_MISSING",
            message: "Gateway token is required.",
            remediation: "Configure gateway token in gateway auth config.",
          },
        ],
      );
    }

    const hardening = readSpawnHardeningConfig();
    if (!hardening.allowlistOverride || !hardening.denylistOverride) {
      return createSpawnPreflightFailure(
        "SPAWN_HARDENING_PRECHECK",
        "Allowlist/denylist override flags are required",
        [
          {
            code: "SPAWN_HARDENING_PRECHECK",
            message: "Missing required allowlist/denylist override configuration.",
            remediation:
              "Set OPENCLAW_SPAWN_ALLOWLIST_OVERRIDE=true and OPENCLAW_SPAWN_DENYLIST_OVERRIDE=true before enabling Spawn.",
          },
        ],
      );
    }

    return createSpawnPreflightSuccess();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cannot evaluate spawn preflight configuration";
    return createSpawnPreflightFailure("SPAWN_PRECHECK_UNKNOWN", message, [
      {
        code: "SPAWN_PRECHECK_UNKNOWN",
        message,
        remediation: "Restart HUD after fixing gateway configuration.",
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
  createSpawnPreflightFailure,
  createSpawnPreflightSuccess,
  createSpawnPreflightLogPayload,
  runStartupProbe,
};
