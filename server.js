const express = require('express');
const path = require('path');
const fs = require('fs');
const JSON5 = require('json5');
const { WebSocketServer } = require('ws');
const http = require('http');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3777;
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw');

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// --- API Helpers ---
function safeRead(fp) {
  try { return fs.readFileSync(fp, 'utf-8'); } catch { return null; }
}
function safeJSON(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { return null; }
}
function safeJSON5(fp) {
  try { return JSON5.parse(fs.readFileSync(fp, 'utf-8')); } catch { return null; }
}
function safeReaddir(dp) {
  try { return fs.readdirSync(dp); } catch { return []; }
}

// --- API: Config / System Status ---
app.get('/api/config', (req, res) => {
  const config = safeJSON5(path.join(OPENCLAW_HOME, 'config', 'source-of-truth.json5'));
  if (!config) return res.json({});
  const defaults = config.agents?.defaults || {};
  const gateway = config.gateway || {};
  const channels = config.channels || {};
  res.json({
    defaultModel: defaults.model?.primary || 'unknown',
    maxConcurrent: defaults.maxConcurrent,
    subagents: defaults.subagents,
    gateway: { port: gateway.port, mode: gateway.mode, bind: gateway.bind },
    channels: Object.keys(channels),
    models: defaults.models || {},
    meta: config.meta
  });
});

// --- API: Agents ---
app.get('/api/agents', (req, res) => {
  const agentsDir = path.join(OPENCLAW_HOME, 'agents');
  const agents = safeReaddir(agentsDir).filter(f => {
    try { return fs.statSync(path.join(agentsDir, f)).isDirectory(); } catch { return false; }
  });

  const result = agents.map(id => {
    const sessFile = path.join(agentsDir, id, 'sessions', 'sessions.json');
    const sessions = safeJSON(sessFile) || {};
    const sessionList = Object.entries(sessions).map(([key, val]) => ({
      key,
      sessionId: val.sessionId,
      updatedAt: val.updatedAt,
      label: val.label,
      spawnedBy: val.spawnedBy,
      spawnDepth: val.spawnDepth,
      lastChannel: val.lastChannel
    }));
    sessionList.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return { id, sessions: sessionList, sessionCount: sessionList.length };
  });
  result.sort((a, b) => {
    const aMax = a.sessions[0]?.updatedAt || 0;
    const bMax = b.sessions[0]?.updatedAt || 0;
    return bMax - aMax;
  });
  res.json(result);
});

// --- API: Sessions (all, flattened) ---
app.get('/api/sessions', (req, res) => {
  const agentsDir = path.join(OPENCLAW_HOME, 'agents');
  const agents = safeReaddir(agentsDir);
  const all = [];
  for (const agentId of agents) {
    const sessFile = path.join(agentsDir, agentId, 'sessions', 'sessions.json');
    const sessions = safeJSON(sessFile) || {};
    for (const [key, val] of Object.entries(sessions)) {
      all.push({ agentId, key, ...val });
    }
  }
  all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  res.json(all.slice(0, 100));
});

// --- API: Session Log ---
app.get('/api/session-log/:agentId/:sessionId', (req, res) => {
  const { agentId, sessionId } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  const logFile = path.join(OPENCLAW_HOME, 'agents', agentId, 'sessions', `${sessionId}.jsonl`);
  const raw = safeRead(logFile);
  if (!raw) return res.json([]);
  const lines = raw.trim().split('\n').filter(Boolean);
  const entries = [];
  for (const line of lines.slice(-limit)) {
    try { entries.push(JSON.parse(line)); } catch {}
  }
  res.json(entries);
});

// --- API: Cron Jobs ---
app.get('/api/cron', (req, res) => {
  const jobs = safeJSON(path.join(OPENCLAW_HOME, 'cron', 'jobs.json'));
  res.json(jobs || { version: 1, jobs: [] });
});

// --- API: Model Usage (sampled from recent sessions) ---
app.get('/api/model-usage', (req, res) => {
  const agentsDir = path.join(OPENCLAW_HOME, 'agents');
  const agents = safeReaddir(agentsDir);
  const usage = {}; // model -> { total: N, agents: { agentId: N } }

  for (const agentId of agents) {
    const sessDir = path.join(agentsDir, agentId, 'sessions');
    const files = safeReaddir(sessDir).filter(f => f.endsWith('.jsonl')).slice(-5);
    for (const file of files) {
      const raw = safeRead(path.join(sessDir, file));
      if (!raw) continue;
      for (const line of raw.split('\n').filter(Boolean)) {
        try {
          const e = JSON.parse(line);
          if (e.type === 'model_change' && e.model) {
            if (!usage[e.model]) usage[e.model] = { total: 0, agents: {} };
            usage[e.model].total++;
            usage[e.model].agents[agentId] = (usage[e.model].agents[agentId] || 0) + 1;
          }
          if (e.type === 'message' && e.model) {
            if (!usage[e.model]) usage[e.model] = { total: 0, agents: {} };
            usage[e.model].total++;
            usage[e.model].agents[agentId] = (usage[e.model].agents[agentId] || 0) + 1;
          }
        } catch {}
      }
    }
  }
  res.json(usage);
});

// --- API: Activity Feed ---
app.get('/api/activity', (req, res) => {
  const agentsDir = path.join(OPENCLAW_HOME, 'agents');
  const agents = safeReaddir(agentsDir);
  const events = [];

  for (const agentId of agents) {
    const sessDir = path.join(agentsDir, agentId, 'sessions');
    const sessions = safeJSON(path.join(sessDir, 'sessions.json')) || {};
    // Get the 3 most recent sessions per agent
    const sorted = Object.entries(sessions).sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0)).slice(0, 3);
    for (const [key, meta] of sorted) {
      const logFile = path.join(sessDir, `${meta.sessionId}.jsonl`);
      const raw = safeRead(logFile);
      if (!raw) continue;
      const lines = raw.trim().split('\n').filter(Boolean).slice(-5);
      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          if (e.timestamp) {
            events.push({
              agentId,
              sessionKey: key,
              type: e.type,
              role: e.role,
              timestamp: e.timestamp,
              content: typeof e.content === 'string' ? e.content.slice(0, 200) : (e.name || e.type),
              toolName: e.name
            });
          }
        } catch {}
      }
    }
  }
  events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json(events.slice(0, 50));
});

// --- WebSocket: push updates every 10s ---
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

setInterval(() => {
  broadcast({ type: 'tick', timestamp: Date.now() });
}, 10000);

server.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║  🔮 OPENCLAW HUD — KIMI K2.5 EDITION    ║`);
  console.log(`  ║  http://localhost:${PORT}                  ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
});
