const path = require("path");
const { Router } = require("express");
const { OPENCLAW_HOME, safeReaddirAsync } = require("../lib/helpers");
const { getCachedSessions } = require("../lib/session-cache");
const { tailLines } = require("../lib/tail-reader");

const router = Router();
const ACTIVITY_CACHE_TTL_MS = 5000;
let activityCache = null;
let activityInflight = null;
const activityDeps = {
  safeReaddirAsync,
  getCachedSessions,
  tailLines,
};

function setActivityDependencies(overrides = {}) {
  Object.assign(activityDeps, overrides);
}

function getActivityDependencies() {
  return activityDeps;
}

async function loadActivityPayload() {
  const agentsDir = path.join(OPENCLAW_HOME, "agents");
  const agents = await activityDeps.safeReaddirAsync(agentsDir);
  const events = [];

  for (const agentId of agents) {
    const sessions = (await activityDeps.getCachedSessions(agentId)) || {};
    const sorted = Object.entries(sessions)
      .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
      .slice(0, 3);
    for (const [key, meta] of sorted) {
      const sessDir = path.join(agentsDir, agentId, "sessions");
      const logFile = path.join(sessDir, `${meta.sessionId}.jsonl`);
      const lines = await activityDeps.tailLines(logFile, 5);
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
  return events.slice(0, 50);
}

router.get("/api/activity", async (req, res) => {
  const now = Date.now();
  if (activityCache && activityCache.expiresAt > now) {
    return res.json(activityCache.payload);
  }

  if (activityInflight) {
    const payload = await activityInflight;
    return res.json(payload);
  }

  const inFlight = (async () => {
    const payload = await loadActivityPayload();
    activityCache = {
      payload,
      expiresAt: Date.now() + ACTIVITY_CACHE_TTL_MS,
    };
    return payload;
  })();
  activityInflight = inFlight;

  try {
    const payload = await inFlight;
    return res.json(payload);
  } finally {
    activityInflight = null;
  }
});

router.__setDependencies = setActivityDependencies;
router.__getDependencies = getActivityDependencies;

module.exports = router;
