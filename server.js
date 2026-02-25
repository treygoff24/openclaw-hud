const express = require("express");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");
const { setupWebSocket } = require("./ws/log-streaming");
const { GatewayWS } = require("./lib/gateway-ws");
const { getGatewayConfig } = require("./lib/helpers");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3777;

process.env.HUD_USAGE_TZ = process.env.HUD_USAGE_TZ || "America/Chicago";
process.env.HUD_USAGE_CACHE_TTL_MS = process.env.HUD_USAGE_CACHE_TTL_MS || "60000";

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

// Gateway WebSocket client
const gwConfig = getGatewayConfig();
const gatewayHost = gwConfig.host || gwConfig.bind || "127.0.0.1";
const gatewayWS = new GatewayWS({
  url: `ws://${formatHostForUrl(gatewayHost)}:${gwConfig.port || 18789}`,
  token: gwConfig.token,
  reconnect: { enabled: true, baseDelayMs: 1000, maxDelayMs: 30000, jitter: true },
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

// Static files
app.use(express.static(path.join(__dirname, "public")));

// Routes
app.use(require("./routes/health"));
app.use(require("./routes/config"));
app.use(require("./routes/agents"));
app.use(require("./routes/sessions"));
app.use(require("./routes/cron"));
app.use(require("./routes/spawn"));
app.use(require("./routes/model-usage"));
app.use(require("./routes/activity"));

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
