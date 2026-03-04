const fs = require("fs");
const path = require("path");
const { Router } = require("express");
const {
  OPENCLAW_HOME,
  safeReaddirAsync,
} = require("../lib/helpers");
const { getCachedSessionEntries } = require("../lib/session-cache");

const router = Router();
const agentsDeps = {
  safeReaddirAsync,
  getCachedSessionEntries,
};

function setAgentsDependencies(overrides = {}) {
  Object.assign(agentsDeps, overrides);
}

router.get("/api/agents", async (req, res) => {
  const agentsDir = path.join(OPENCLAW_HOME, "agents");
  const allEntries = await agentsDeps.safeReaddirAsync(agentsDir);
  const candidateAgents = await Promise.all(allEntries.map(async (entry) => {
    try {
      const stat = await fs.promises.stat(path.join(agentsDir, entry));
      return stat.isDirectory() ? entry : null;
    } catch {
      return null;
    }
  }));
  const agents = candidateAgents.filter(Boolean);

  const now = Date.now();
  const result = await Promise.all(agents.map(async (id) => {
    const { sessions: sessionList } = await agentsDeps.getCachedSessionEntries(id);
    const sorted = [...sessionList].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    let activeSessions = 0;
    for (const session of sessionList) {
      if (session.updatedAt && now - session.updatedAt < 3600000) {
        activeSessions += 1;
      }
    }
    return { id, sessions: sorted, sessionCount: sessionList.length, activeSessions };
  }));

  result.sort((a, b) => {
    const aMax = a.sessions[0]?.updatedAt || 0;
    const bMax = b.sessions[0]?.updatedAt || 0;
    return bMax - aMax;
  });
  res.json(result);
});

router.__setDependencies = setAgentsDependencies;

module.exports = router;
