const path = require("path");
const { Router } = require("express");
const { OPENCLAW_HOME, safeReaddirAsync } = require("../lib/helpers");
const { getCachedSessions } = require("../lib/session-cache");
const { tailLines } = require("../lib/tail-reader");

const router = Router();

router.get("/api/activity", async (req, res) => {
  const agentsDir = path.join(OPENCLAW_HOME, "agents");
  const agents = await safeReaddirAsync(agentsDir);
  const events = [];

  for (const agentId of agents) {
    const sessions = (await getCachedSessions(agentId)) || {};
    const sorted = Object.entries(sessions)
      .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
      .slice(0, 3);
    for (const [key, meta] of sorted) {
      const sessDir = path.join(agentsDir, agentId, "sessions");
      const logFile = path.join(sessDir, `${meta.sessionId}.jsonl`);
      const lines = await tailLines(logFile, 5);
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
              content: typeof e.content === "string" ? e.content.slice(0, 200) : e.name || e.type,
              toolName: e.name,
            });
          }
        } catch {}
      }
    }
  }
  events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json(events.slice(0, 50));
});

module.exports = router;
