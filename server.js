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
process.env.HUD_USAGE_CACHE_TTL_MS = process.env.HUD_USAGE_CACHE_TTL_MS || "15000";

function formatHostForUrl(host) {
  const normalized = String(host || "").trim();
  if (!normalized) return "127.0.0.1";
  if (normalized.toLowerCase() === "loopback") return "127.0.0.1";
  if (normalized.includes(":") && !normalized.startsWith("[")) return `[${normalized}]`;
  return normalized;
}

// Gateway WebSocket client
const gwConfig = getGatewayConfig();
const gatewayHost = gwConfig.host || gwConfig.bind || "127.0.0.1";
const gatewayWS = new GatewayWS({
  url: `ws://${formatHostForUrl(gatewayHost)}:${gwConfig.port || 18789}`,
  token: gwConfig.token,
  reconnect: { enabled: true, baseDelayMs: 1000, maxDelayMs: 30000, jitter: true },
});

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
  socket.send(
    JSON.stringify({
      type: "gateway-status",
      status: gatewayWS.connected ? "connected" : "disconnected",
    }),
  );
});
setInterval(() => broadcastAll({ type: "tick", timestamp: Date.now() }), 10000);

// Gateway status broadcasts
gatewayWS.on("connected", () => broadcastAll({ type: "gateway-status", status: "connected" }));
gatewayWS.on("disconnected", () =>
  broadcastAll({ type: "gateway-status", status: "disconnected" }),
);
gatewayWS.on("error", (err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Gateway WS error:", message);
  broadcastAll({ type: "gateway-status", status: "disconnected" });
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
