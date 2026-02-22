const fs = require('fs');
const path = require('path');
const { Router } = require('express');
const { OPENCLAW_HOME, safeJSON, safeReaddir } = require('../lib/helpers');

const router = Router();

router.get('/api/agents', (req, res) => {
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

module.exports = router;
