const path = require('path');
const { Router } = require('express');
const { OPENCLAW_HOME, safeJSON, safeReaddir, safeRead, getSessionStatus } = require('../lib/helpers');

const router = Router();

const ONE_DAY = 24 * 60 * 60 * 1000;
const AGENT_ID_RE = /^[a-zA-Z0-9_-]+$/;
const LEGACY_SESSION_KEY_RE = /^[a-zA-Z0-9:_-]+$/;
const CANONICAL_SESSION_KEY_RE = /^agent:[a-zA-Z0-9_-]+:[a-zA-Z0-9:_-]+$/;

function canonicalizeSessionKey(agentId, storedKey) {
  if (!AGENT_ID_RE.test(agentId)) {
    throw new Error(`Invalid agentId "${agentId}" for session key canonicalization`);
  }
  if (typeof storedKey !== 'string' || !storedKey.trim()) {
    throw new Error('Session key must be a non-empty string');
  }
  if (CANONICAL_SESSION_KEY_RE.test(storedKey)) {
    const [, keyAgentId] = storedKey.split(':');
    if (keyAgentId !== agentId) {
      throw new Error(`Canonical session key "${storedKey}" does not match agent "${agentId}"`);
    }
    return storedKey;
  }
  if (!LEGACY_SESSION_KEY_RE.test(storedKey)) {
    throw new Error(`Invalid legacy session key "${storedKey}"`);
  }
  return `agent:${agentId}:${storedKey}`;
}

router.get('/api/sessions', (req, res) => {
  const agentsDir = path.join(OPENCLAW_HOME, 'agents');
  const agents = safeReaddir(agentsDir);
  const all = [];
  const invalid = [];
  for (const agentId of agents) {
    const sessFile = path.join(agentsDir, agentId, 'sessions', 'sessions.json');
    const sessions = safeJSON(sessFile) || {};
    for (const [key, val] of Object.entries(sessions)) {
      try {
        const sessionKey = canonicalizeSessionKey(agentId, key);
        const s = { agentId, key, sessionKey, ...val };
        s.status = getSessionStatus(s);
        all.push(s);
      } catch (err) {
        invalid.push({ agentId, key, error: err.message });
      }
    }
  }
  if (invalid.length > 0) {
    return res.status(500).json({ error: 'Invalid session keys in sessions.json', invalid });
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
  const invalid = [];

  for (const agentId of agents) {
    const sessFile = path.join(agentsDir, agentId, 'sessions', 'sessions.json');
    const sessions = safeJSON(sessFile) || {};
    for (const [key, val] of Object.entries(sessions)) {
      try {
        const sessionKey = canonicalizeSessionKey(agentId, key);
        allSessions[key] = { key, sessionKey, agentId, ...val };
      } catch (err) {
        invalid.push({ agentId, key, error: err.message });
      }
    }
  }
  if (invalid.length > 0) {
    return res.status(500).json({ error: 'Invalid session keys in sessions.json', invalid });
  }

  const childCounts = {};
  for (const s of Object.values(allSessions)) {
    if (s.spawnedBy && allSessions[s.spawnedBy]) {
      childCounts[s.spawnedBy] = (childCounts[s.spawnedBy] || 0) + 1;
    }
  }

  const result = Object.values(allSessions).map(s => ({
    key: s.key,
    sessionKey: s.sessionKey,
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
