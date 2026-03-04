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
    const { sessions: sessionList } = await agentsDeps.getCachedSessionEntries(id);
    const sorted = [...sessionList].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const activeSessions = sessionList.filter(
      (s) => s.updatedAt && Date.now() - s.updatedAt < 3600000,
    ).length;
    result.push({ id, sessions: sorted, sessionCount: sessionList.length, activeSessions });
  }
  result.sort((a, b) => {
    const aMax = a.sessions[0]?.updatedAt || 0;
    const bMax = b.sessions[0]?.updatedAt || 0;
    return bMax - aMax;
  });
  res.json(result);
});

router.__setDependencies = setAgentsDependencies;

module.exports = router;
