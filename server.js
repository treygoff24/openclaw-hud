const express = require('express');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');
const { setupWebSocket } = require('./ws/log-streaming');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3777;

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use(require('./routes/config'));
app.use(require('./routes/agents'));
app.use(require('./routes/sessions'));
app.use(require('./routes/cron'));
app.use(require('./routes/spawn'));
app.use(require('./routes/activity'));

// WebSocket: push ticks every 10s
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}
setInterval(() => broadcast({ type: 'tick', timestamp: Date.now() }), 10000);

// WebSocket: log streaming
setupWebSocket(wss);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║  🔮 OPENCLAW HUD — KIMI K2.5 EDITION    ║`);
  console.log(`  ║  http://localhost:${PORT}                  ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
});
