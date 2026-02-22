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

// --- Helper: Strip sensitive fields recursively ---
function stripSecrets(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripSecrets);
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/apiKey|token|password|secret|authorization|credential|private_key|signing_key/i.test(k)) continue;
    clean[k] = stripSecrets(v);
  }
  return clean;
}

// --- API: Config / System Status (Phase 6: enhanced) ---
app.get('/api/config', (req, res) => {
  const config = safeJSON5(path.join(OPENCLAW_HOME, 'config', 'source-of-truth.json5'));
  if (!config) return res.json({});
  const defaults = config.agents?.defaults || {};
  const gateway = config.gateway || {};
  const channels = config.channels || {};
  const models = config.models || {};
  res.json(stripSecrets({
    defaultModel: defaults.model?.primary || 'unknown',
    maxConcurrent: defaults.maxConcurrent,
    subagents: defaults.subagents,
    gateway: { port: gateway.port, mode: gateway.mode, bind: gateway.bind },
    channels: Object.keys(channels),
    models: defaults.models || {},
    modelAliases: defaults.models || {},
    providers: Object.keys(models.providers || {}),
    meta: config.meta
  }));
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
    const activeSessions = sessionList.filter(s => s.updatedAt && (Date.now() - s.updatedAt) < 3600000).length;
    return { id, sessions: sessionList, sessionCount: sessionList.length, activeSessions };
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
      const s = { agentId, key, ...val };
      s.status = getSessionStatus(s);
      all.push(s);
    }
  }
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const recent = all.filter(s => s.updatedAt && (Date.now() - s.updatedAt) < ONE_DAY);
  recent.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  res.json(recent.slice(0, 100));
});

// --- API: Session Log ---
app.get('/api/session-log/:agentId/:sessionId', (req, res) => {
  const { agentId, sessionId } = req.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(agentId) || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }
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

// --- API: Cron Jobs (Phase 8: enriched with model info) ---
app.get('/api/cron', (req, res) => {
  const jobs = safeJSON(path.join(OPENCLAW_HOME, 'cron', 'jobs.json'));
  const config = safeJSON5(path.join(OPENCLAW_HOME, 'config', 'source-of-truth.json5'));
  const defaultModel = config?.agents?.defaults?.model?.primary || 'unknown';

  const enrichedJobs = ((jobs?.jobs) || []).map(j => ({
    ...j,
    defaultModel,
    modelOverride: j.payload?.model || j.model || null,
    usesDefaultModel: !(j.payload?.model || j.model),
  }));

  res.json(stripSecrets({ version: jobs?.version || 1, jobs: enrichedJobs }));
});

// --- API: Cron Job Update ---
app.put('/api/cron/:jobId', express.json(), (req, res) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(req.params.jobId)) {
    return res.status(400).json({ error: 'Invalid job ID' });
  }
  const jobsPath = path.join(OPENCLAW_HOME, 'cron', 'jobs.json');
  const data = safeJSON(jobsPath);
  if (!data) return res.status(500).json({ error: 'Cannot read jobs file' });

  const jobIndex = data.jobs.findIndex(j => j.id === req.params.jobId);
  if (jobIndex === -1) return res.status(404).json({ error: 'Job not found' });

  // Backup
  try { fs.copyFileSync(jobsPath, jobsPath + '.bak'); } catch {}

  const updates = req.body;
  const job = data.jobs[jobIndex];
  const editable = ['name', 'enabled', 'agentId', 'schedule', 'sessionTarget', 'wakeMode', 'payload', 'delivery'];
  for (const key of editable) {
    if (updates[key] !== undefined) job[key] = updates[key];
  }

  // Enforce constraints
  if (job.sessionTarget === 'main' && job.payload?.kind !== 'systemEvent') job.payload.kind = 'systemEvent';
  if (job.sessionTarget === 'isolated' && job.payload?.kind !== 'agentTurn') job.payload.kind = 'agentTurn';
  job.updatedAtMs = Date.now();

  try {
    fs.writeFileSync(jobsPath, JSON.stringify(data, null, 2));
    res.json({ ok: true, job });
  } catch (err) {
    res.status(500).json({ error: 'Failed to write jobs file' });
  }
});

// --- API: Cron Job Toggle ---
app.post('/api/cron/:jobId/toggle', (req, res) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(req.params.jobId)) {
    return res.status(400).json({ error: 'Invalid job ID' });
  }
  const jobsPath = path.join(OPENCLAW_HOME, 'cron', 'jobs.json');
  const data = safeJSON(jobsPath);
  if (!data) return res.status(500).json({ error: 'Cannot read jobs file' });

  const job = data.jobs.find(j => j.id === req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  try { fs.copyFileSync(jobsPath, jobsPath + '.bak'); } catch {}
  job.enabled = !job.enabled;
  job.updatedAtMs = Date.now();

  try {
    fs.writeFileSync(jobsPath, JSON.stringify(data, null, 2));
    res.json({ ok: true, enabled: job.enabled });
  } catch (err) {
    res.status(500).json({ error: 'Failed to write jobs file' });
  }
});

// --- API: Model Usage (sampled from recent sessions) ---
app.get('/api/model-usage', (req, res) => {
  const agentsDir = path.join(OPENCLAW_HOME, 'agents');
  const agents = safeReaddir(agentsDir);
  const usage = {}; // model -> { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens, totalCost, agents }

  const ensure = (model) => {
    if (!usage[model]) usage[model] = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, totalCost: 0, agents: {} };
  };
  const ensureAgent = (model, agentId) => {
    if (!usage[model].agents[agentId]) usage[model].agents[agentId] = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  };

  for (const agentId of agents) {
    const sessDir = path.join(agentsDir, agentId, 'sessions');
    const files = safeReaddir(sessDir).filter(f => f.endsWith('.jsonl'))
      .map(f => { try { return { name: f, mtime: fs.statSync(path.join(sessDir, f)).mtimeMs }; } catch { return null; } })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 10)
      .map(f => f.name);
    for (const file of files) {
      const raw = safeRead(path.join(sessDir, file));
      if (!raw) continue;
      let currentModel = null;
      for (const line of raw.split('\n').filter(Boolean)) {
        try {
          const e = JSON.parse(line);
          if (e.type === 'model_change' && e.modelId) {
            currentModel = e.modelId;
          }
          if (e.type === 'message' && e.message?.usage) {
            const u = e.message.usage;
            const model = e.message.model || currentModel || 'unknown';
            ensure(model);
            ensureAgent(model, agentId);
            const inp = u.input || 0;
            const out = u.output || 0;
            const cr = u.cacheRead || 0;
            const cw = u.cacheWrite || 0;
            const tot = u.totalTokens || (inp + out + cr + cw);
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
        } catch {}
      }
    }
  }
  res.json(usage);
});

// --- API: Session Tree ---
function getSessionStatus(session) {
  const age = Date.now() - (session.updatedAt || 0);
  const isSubagent = (session.spawnDepth || 0) > 0;
  const fiveMin = 5 * 60 * 1000;
  const oneHour = 60 * 60 * 1000;
  if (age < fiveMin) return 'active';
  if (isSubagent && age >= fiveMin) return 'completed';
  if (age < oneHour) return 'warm';
  return 'stale';
}

app.get('/api/session-tree', (req, res) => {
  const agentsDir = path.join(OPENCLAW_HOME, 'agents');
  const agents = safeReaddir(agentsDir);
  const allSessions = {};

  for (const agentId of agents) {
    const sessFile = path.join(agentsDir, agentId, 'sessions', 'sessions.json');
    const sessions = safeJSON(sessFile) || {};
    for (const [key, val] of Object.entries(sessions)) {
      allSessions[key] = { key, agentId, ...val };
    }
  }

  // Build flat list with childCount
  const childCounts = {};
  for (const s of Object.values(allSessions)) {
    if (s.spawnedBy && allSessions[s.spawnedBy]) {
      childCounts[s.spawnedBy] = (childCounts[s.spawnedBy] || 0) + 1;
    }
  }

  const result = Object.values(allSessions).map(s => ({
    key: s.key,
    agentId: s.agentId,
    label: s.label || null,
    sessionId: s.sessionId,
    spawnedBy: (s.spawnedBy && allSessions[s.spawnedBy]) ? s.spawnedBy : null,
    spawnDepth: s.spawnDepth || 0,
    updatedAt: s.updatedAt || 0,
    lastChannel: s.lastChannel || null,
    groupChannel: s.groupChannel || null,
    childCount: childCounts[s.key] || 0,
    status: getSessionStatus(s)
  }));

  const ONE_DAY = 24 * 60 * 60 * 1000;
  const filtered = result.filter(s => s.updatedAt && (Date.now() - s.updatedAt) < ONE_DAY);
  filtered.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  res.json(filtered);
});

// --- API: Model Aliases ---
app.get('/api/models', (req, res) => {
  const config = safeJSON5(path.join(OPENCLAW_HOME, 'config', 'source-of-truth.json5'));
  const models = config?.agents?.defaults?.models || {};
  const aliases = Object.entries(models).map(([fullId, cfg]) => ({
    alias: cfg.alias || fullId.split('/').pop(),
    fullId,
  }));
  // Add agent-specific models not in global config
  const agentModels = [
    { alias: 'haiku', fullId: 'anthropic/claude-haiku-4' },
    { alias: 'vulcan (codex)', fullId: 'openai/gpt-5.3-codex' },
  ];
  for (const am of agentModels) {
    if (!aliases.find(a => a.fullId === am.fullId)) aliases.push(am);
  }
  aliases.unshift({ alias: 'default', fullId: '' });
  res.json(aliases);
});

// --- Spawn Session helpers ---
// Note: Rate limiter is in-memory and resets on server restart.
// This is intentional for single-user local use.
const spawnTimestamps = [];
const MAX_SPAWNS_PER_MINUTE = 5;

const ALLOWED_ROOTS = [
  path.join(os.homedir(), 'Development'),
  path.join(os.homedir(), '.openclaw'),
  path.join(os.homedir(), 'Dropbox'),
];

function validateContextFiles(filesText) {
  const files = filesText.trim().split('\n').map(f => f.trim()).filter(Boolean);
  if (files.length > 20) return { error: 'Max 20 context files' };
  for (const f of files) {
    const resolved = path.resolve(f.replace(/^~/, os.homedir()));
    if (!ALLOWED_ROOTS.some(root => resolved.startsWith(root + path.sep) || resolved === root)) {
      return { error: `File not in allowed directory: ${f}` };
    }
    try {
      const real = fs.realpathSync(resolved);
      if (!ALLOWED_ROOTS.some(root => real.startsWith(root + path.sep) || real === root)) {
        return { error: `Path escapes allowed directory via symlink: ${f}` };
      }
    } catch (err) {
      if (err.code !== 'ENOENT') return { error: `Cannot resolve path: ${f}` };
    }
  }
  return { valid: files };
}

function getGatewayConfig() {
  const config = safeJSON5(path.join(OPENCLAW_HOME, 'config', 'source-of-truth.json5'));
  const gw = config?.gateway || {};
  const auth = gw.auth || {};
  return {
    port: gw.port || 18789,
    token: process.env.OPENCLAW_GATEWAY_TOKEN || auth.token || null
  };
}

// --- API: Spawn Session ---
// Security: This endpoint proxies to the gateway. Safe because server binds to 127.0.0.1 only.
// If binding changes, add bearer token auth here.
app.post('/api/spawn', express.json(), async (req, res) => {
  const { agentId, model, label, prompt, contextFiles, timeout, mode } = req.body;

  // Rate limit (count BEFORE gateway call to prevent spam even on failures)
  const now = Date.now();
  while (spawnTimestamps.length && spawnTimestamps[0] < now - 60000) spawnTimestamps.shift();
  if (spawnTimestamps.length >= MAX_SPAWNS_PER_MINUTE) {
    return res.status(429).json({ error: 'Rate limit: max 5 spawns per minute' });
  }

  // Validate
  if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' });
  if (prompt.length > 50000) return res.status(400).json({ error: 'Prompt too long (max 50,000 chars)' });
  if (!agentId) return res.status(400).json({ error: 'Agent is required' });
  if (mode && !['run', 'session'].includes(mode)) return res.status(400).json({ error: 'Invalid mode' });
  if (label && !/^[a-zA-Z0-9_-]{1,64}$/.test(label)) return res.status(400).json({ error: 'Invalid label: alphanumeric, hyphens, underscores only (max 64 chars)' });
  if (timeout != null && (timeout < 0 || timeout > 7200)) return res.status(400).json({ error: 'Timeout must be 0-7200 seconds' });

  // Build task prompt
  let task = prompt.trim();
  if (contextFiles?.trim()) {
    const result = validateContextFiles(contextFiles);
    if (result.error) return res.status(400).json({ error: result.error });
    task = `## Context Files\nRead these files first for context:\n${result.valid.map(f => `- \`${f}\``).join('\n')}\n\n## Task\n${task}`;
  }

  // Gateway config
  const gw = getGatewayConfig();
  if (!gw.token) return res.status(500).json({ error: 'Gateway token not configured' });

  // Count AFTER validation but BEFORE gateway call
  spawnTimestamps.push(Date.now());

  // Spawn via gateway HTTP API
  try {
    const gwRes = await fetch(`http://127.0.0.1:${gw.port}/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${gw.token}`
      },
      body: JSON.stringify({
        tool: 'sessions_spawn',
        args: {
          task,
          mode: mode || 'run',
          ...(model && { model }),
          ...(label && { label }),
          ...(timeout != null && timeout > 0 && { runTimeoutSeconds: timeout })
        }
      })
    });

    if (!gwRes.ok) {
      const errBody = await gwRes.text();
      let detail = errBody;
      try { detail = JSON.parse(errBody).error?.message || errBody; } catch {}
      return res.status(502).json({ error: `Gateway error: ${detail}` });
    }

    const result = await gwRes.json();
    console.log('[spawn] Gateway response:', JSON.stringify(result).slice(0, 500));

    const details = result?.result?.details || result?.details || {};
    res.json({
      ok: true,
      sessionKey: details.childSessionKey || null,
      runId: details.runId || null
    });
  } catch (err) {
    res.status(502).json({ error: `Cannot reach gateway: ${err.message}` });
  }
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

// --- WebSocket: Log subscription protocol ---
const logWatchers = new Map(); // filePath -> { watcher, dirWatcher, clients: Set<ws>, offset, debounceTimer, sessionId }

function getLogFilePath(agentId, sessionId) {
  return path.join(OPENCLAW_HOME, 'agents', agentId, 'sessions', `${sessionId}.jsonl`);
}

function readNewEntries(entry) {
  const { filePath, sessionId } = entry;
  let stat;
  try { stat = fs.statSync(filePath); } catch { return; }

  // Handle file rotation
  if (stat.size < entry.offset) entry.offset = 0;
  if (stat.size === entry.offset) return;

  const bytesToRead = stat.size - entry.offset;
  const buf = Buffer.alloc(bytesToRead);
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, bytesToRead, entry.offset);
  } catch { return; } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  entry.offset = stat.size;

  const lines = buf.toString('utf-8').split('\n').filter(Boolean);
  for (const line of lines) {
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    const msg = JSON.stringify({ type: 'log-entry', sessionId, agentId: entry.agentId, entry: parsed });
    for (const client of entry.clients) {
      if (client.readyState === 1) client.send(msg);
    }
  }
}

function startWatcher(filePath, sessionId) {
  const entry = { watcher: null, dirWatcher: null, clients: new Set(), offset: 0, debounceTimer: null, filePath, sessionId };

  const setupFileWatch = () => {
    try { entry.offset = fs.statSync(filePath).size; } catch { entry.offset = 0; }
    try {
      entry.watcher = fs.watch(filePath, () => {
        if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
        entry.debounceTimer = setTimeout(() => readNewEntries(entry), 100);
      });
      entry.watcher.on('error', () => {});
    } catch {}
  };

  if (fs.existsSync(filePath)) {
    setupFileWatch();
  } else {
    // Watch directory for file creation
    const dir = path.dirname(filePath);
    const basename = path.basename(filePath);
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    try {
      entry.dirWatcher = fs.watch(dir, (eventType, filename) => {
        if (filename === basename && fs.existsSync(filePath)) {
          if (entry.dirWatcher) { entry.dirWatcher.close(); entry.dirWatcher = null; }
          setupFileWatch();
        }
      });
      entry.dirWatcher.on('error', () => {});
    } catch {}
  }

  logWatchers.set(filePath, entry);
  return entry;
}

function removeClientFromWatcher(filePath, client) {
  const entry = logWatchers.get(filePath);
  if (!entry) return;
  entry.clients.delete(client);
  if (entry.clients.size === 0) {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    if (entry.watcher) entry.watcher.close();
    if (entry.dirWatcher) entry.dirWatcher.close();
    logWatchers.delete(filePath);
  }
}

// Track client -> subscribed file paths for cleanup on disconnect
const clientSubscriptions = new WeakMap(); // ws -> Set<filePath>

const ID_RE = /^[a-zA-Z0-9_-]+$/;

wss.on('connection', (ws) => {
  clientSubscriptions.set(ws, new Set());

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || !msg.type) return;

    if (msg.type === 'subscribe-log') {
      const { agentId, sessionId } = msg;
      if (!agentId || !sessionId || !ID_RE.test(agentId) || !ID_RE.test(sessionId)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid agentId or sessionId' }));
        return;
      }
      const filePath = getLogFilePath(agentId, sessionId);
      let entry = logWatchers.get(filePath);
      if (!entry) entry = startWatcher(filePath, sessionId);
      entry.agentId = agentId;
      entry.clients.add(ws);
      clientSubscriptions.get(ws).add(filePath);
      ws.send(JSON.stringify({ type: 'subscribed', sessionId }));
    } else if (msg.type === 'unsubscribe-log') {
      const { sessionId } = msg;
      if (!sessionId) return;
      // Find the watcher for this sessionId
      for (const [filePath, entry] of logWatchers) {
        if (entry.sessionId === sessionId) {
          removeClientFromWatcher(filePath, ws);
          const subs = clientSubscriptions.get(ws);
          if (subs) subs.delete(filePath);
          break;
        }
      }
    }
    // Unknown types are silently ignored
  });

  ws.on('close', () => {
    const subs = clientSubscriptions.get(ws);
    if (subs) {
      for (const filePath of subs) {
        removeClientFromWatcher(filePath, ws);
      }
    }
  });
});

// Periodic cleanup: sweep for leaked watchers with zero subscribers
setInterval(() => {
  for (const [filePath, entry] of logWatchers) {
    if (entry.clients.size === 0) {
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
      if (entry.watcher) entry.watcher.close();
      if (entry.dirWatcher) entry.dirWatcher.close();
      logWatchers.delete(filePath);
    }
  }
}, 60000);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║  🔮 OPENCLAW HUD — KIMI K2.5 EDITION    ║`);
  console.log(`  ║  http://localhost:${PORT}                  ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
});
