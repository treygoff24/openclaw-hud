const fs = require("fs");
const path = require("path");
const { Router } = require("express");
const {
  OPENCLAW_HOME,
  safeReaddirAsync,
  canonicalizeSessionKey,
  getModelAliasMap,
  enrichSessionMetadata,
} = require("../lib/helpers");
const { getCachedSessions } = require("../lib/session-cache");

const router = Router();

router.get("/api/agents", async (req, res) => {
  const agentsDir = path.join(OPENCLAW_HOME, "agents");
  const modelAliases = getModelAliasMap();
  const allEntries = await safeReaddirAsync(agentsDir);
  const agents = [];
  for (const f of allEntries) {
    try {
      const stat = await fs.promises.stat(path.join(agentsDir, f));
      if (stat.isDirectory()) agents.push(f);
    } catch {
      // skip entries that can't be stat'd
    }
  }

  const result = [];
  for (const id of agents) {
    const sessions = (await getCachedSessions(id)) || {};
    const sessionList = Object.entries(sessions).reduce((acc, [key, val]) => {
      let sessionKey;
      try {
        sessionKey = canonicalizeSessionKey(id, key);
      } catch {
        return acc;
      }
      acc.push({
        key,
        sessionKey,
        sessionId: val.sessionId,
        updatedAt: val.updatedAt,
        label: val.label,
        spawnedBy: val.spawnedBy,
        spawnDepth: val.spawnDepth,
        lastChannel: val.lastChannel,
        groupChannel: val.groupChannel,
        ...enrichSessionMetadata(sessionKey, { ...val, sessionKey }, { sessionKey, modelAliases }),
      });
      return acc;
    }, []);
    sessionList.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const activeSessions = sessionList.filter(
      (s) => s.updatedAt && Date.now() - s.updatedAt < 3600000,
    ).length;
    result.push({ id, sessions: sessionList, sessionCount: sessionList.length, activeSessions });
  }
  result.sort((a, b) => {
    const aMax = a.sessions[0]?.updatedAt || 0;
    const bMax = b.sessions[0]?.updatedAt || 0;
    return bMax - aMax;
  });
  res.json(result);
});

module.exports = router;
