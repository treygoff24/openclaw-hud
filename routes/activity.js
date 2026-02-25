const path = require("path");
const { Router } = require("express");
const { OPENCLAW_HOME, safeJSON, safeReaddir, safeRead } = require("../lib/helpers");

const router = Router();

router.get("/api/activity", (req, res) => {
  const agentsDir = path.join(OPENCLAW_HOME, "agents");
  const agents = safeReaddir(agentsDir);
  const events = [];

  for (const agentId of agents) {
    const sessDir = path.join(agentsDir, agentId, "sessions");
    const sessions = safeJSON(path.join(sessDir, "sessions.json")) || {};
    const sorted = Object.entries(sessions)
      .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
      .slice(0, 3);
    for (const [key, meta] of sorted) {
      const logFile = path.join(sessDir, `${meta.sessionId}.jsonl`);
      const raw = safeRead(logFile);
      if (!raw) continue;
      const lines = raw.trim().split("\n").filter(Boolean).slice(-5);
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
