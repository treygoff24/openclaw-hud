const express = require('express');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');
const { setupWebSocket } = require('./ws/log-streaming');
const { GatewayWS } = require('./lib/gateway-ws');
const { getGatewayConfig } = require('./lib/helpers');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3777;

// Gateway WebSocket client
const gwConfig = getGatewayConfig();
const gatewayWS = new GatewayWS({
  url: `ws://127.0.0.1:${gwConfig.port || 18789}`,
  token: gwConfig.token,
  reconnect: { enabled: true, baseDelayMs: 1000, maxDelayMs: 30000, jitter: true }
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use(require('./routes/health'));
app.use(require('./routes/config'));
app.use(require('./routes/agents'));
app.use(require('./routes/sessions'));
app.use(require('./routes/cron'));
app.use(require('./routes/spawn'));
app.use(require('./routes/activity'));

// WebSocket: push ticks every 10s
function broadcastAll(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}
setInterval(() => broadcastAll({ type: 'tick', timestamp: Date.now() }), 10000);

// Gateway status broadcasts
gatewayWS.on('connected', () => broadcastAll({ type: 'gateway-status', status: 'connected' }));
gatewayWS.on('disconnected', () => broadcastAll({ type: 'gateway-status', status: 'disconnected' }));

// Connect (non-blocking)
gatewayWS.connect().catch(err => console.error('Gateway WS initial connect failed:', err));

// WebSocket: log streaming + chat
setupWebSocket(wss, gatewayWS);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║  🔮 OPENCLAW HUD — KIMI K2.5 EDITION    ║`);
  console.log(`  ║  http://localhost:${PORT}                  ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
});
