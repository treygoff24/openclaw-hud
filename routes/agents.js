const fs = require('fs');
const path = require('path');
const { Router } = require('express');
const {
  OPENCLAW_HOME,
  safeJSON,
  safeReaddir,
  canonicalizeSessionKey,
  enrichSessionMetadata
} = require('../lib/helpers');

const router = Router();

function safeCanonicalizeSessionKey(agentId, key) {
  try {
    return canonicalizeSessionKey(agentId, key);
  } catch {
    return `agent:${agentId}:${key}`;
  }
}

router.get('/api/agents', (req, res) => {
  const agentsDir = path.join(OPENCLAW_HOME, 'agents');
  const agents = safeReaddir(agentsDir).filter(f => {
    try { return fs.statSync(path.join(agentsDir, f)).isDirectory(); } catch { return false; }
  });

  const result = agents.map(id => {
    const sessFile = path.join(agentsDir, id, 'sessions', 'sessions.json');
    const sessions = safeJSON(sessFile) || {};
    const sessionList = Object.entries(sessions).map(([key, val]) => {
      const sessionKey = safeCanonicalizeSessionKey(id, key);
      return {
        key,
        sessionKey,
        sessionId: val.sessionId,
        updatedAt: val.updatedAt,
        label: val.label,
        spawnedBy: val.spawnedBy,
        spawnDepth: val.spawnDepth,
        lastChannel: val.lastChannel,
        groupChannel: val.groupChannel,
        ...enrichSessionMetadata(sessionKey, { ...val, sessionKey }, { sessionKey })
      };
    });
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

module.exports = router;
