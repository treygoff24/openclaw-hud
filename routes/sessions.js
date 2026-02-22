const path = require('path');
const { Router } = require('express');
const { OPENCLAW_HOME, safeJSON, safeReaddir, safeRead, getSessionStatus } = require('../lib/helpers');

const router = Router();

const ONE_DAY = 24 * 60 * 60 * 1000;

router.get('/api/sessions', (req, res) => {
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
  const recent = all.filter(s => s.updatedAt && (Date.now() - s.updatedAt) < ONE_DAY);
  recent.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  res.json(recent.slice(0, 100));
});

router.get('/api/session-log/:agentId/:sessionId', (req, res) => {
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

router.get('/api/session-tree', (req, res) => {
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

  const filtered = result.filter(s => s.updatedAt && (Date.now() - s.updatedAt) < ONE_DAY);
  filtered.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  res.json(filtered);
});

module.exports = router;
