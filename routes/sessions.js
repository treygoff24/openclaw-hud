const path = require("path");
const { Router } = require("express");
const {
  OPENCLAW_HOME,
  safeJSON,
  safeReaddir,
  safeRead,
  getSessionStatus,
  canonicalizeSessionKey,
  canonicalizeRelationshipKey,
  getModelAliasMap,
  enrichSessionMetadata,
} = require("../lib/helpers");

const router = Router();

const ONE_DAY = 24 * 60 * 60 * 1000;
const CANONICAL_SESSION_KEY_RE = /^agent:[a-zA-Z0-9_-]+:[a-zA-Z0-9:_-]+$/;

function mergeCanonicalSessionEntry(allSessions, candidate) {
  const existing = allSessions[candidate.sessionKey];
  if (!existing) {
    allSessions[candidate.sessionKey] = candidate;
    return;
  }

  const existingIsCanonical = CANONICAL_SESSION_KEY_RE.test(existing.key);
  const candidateIsCanonical = CANONICAL_SESSION_KEY_RE.test(candidate.key);

  // If both legacy and canonical aliases exist for the same logical session,
  // always prefer the canonical stored key representation.
  if (!existingIsCanonical && candidateIsCanonical) {
    allSessions[candidate.sessionKey] = candidate;
  }
}

router.get("/api/sessions", (req, res) => {
  const agentsDir = path.join(OPENCLAW_HOME, "agents");
  const agents = safeReaddir(agentsDir);
  const modelAliases = getModelAliasMap();
  const all = [];
  const invalid = [];
  for (const agentId of agents) {
    const sessFile = path.join(agentsDir, agentId, "sessions", "sessions.json");
    const sessions = safeJSON(sessFile) || {};
    for (const [key, val] of Object.entries(sessions)) {
      try {
        const sessionKey = canonicalizeSessionKey(agentId, key);
        const s = { agentId, key, sessionKey, ...val };
        const displayMeta = enrichSessionMetadata(sessionKey, val, { sessionKey, modelAliases });
        s.status = getSessionStatus(s);
        Object.assign(s, displayMeta);
        all.push(s);
      } catch (err) {
        invalid.push({ agentId, key, error: err.message });
      }
    }
  }
  if (invalid.length > 0) {
    return res.status(500).json({ error: "Invalid session keys in sessions.json", invalid });
  }
  const recent = all.filter((s) => s.updatedAt && Date.now() - s.updatedAt < ONE_DAY);
  recent.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  res.json(recent.slice(0, 100));
});

router.get("/api/session-log/:agentId/:sessionId", (req, res) => {
  const { agentId, sessionId } = req.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(agentId) || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    return res.status(400).json({ error: "Invalid parameters" });
  }
  const limit = parseInt(req.query.limit) || 50;
  const logFile = path.join(OPENCLAW_HOME, "agents", agentId, "sessions", `${sessionId}.jsonl`);
  const raw = safeRead(logFile);
  if (!raw) return res.json([]);
  const lines = raw.trim().split("\n").filter(Boolean);
  const entries = [];
  for (const line of lines.slice(-limit)) {
    try {
      entries.push(JSON.parse(line));
    } catch {}
  }
  res.json(entries);
});

router.get("/api/session-tree", (req, res) => {
  const agentsDir = path.join(OPENCLAW_HOME, "agents");
  const agents = safeReaddir(agentsDir);
  const modelAliases = getModelAliasMap();
  const allSessions = {};
  const invalid = [];

  for (const agentId of agents) {
    const sessFile = path.join(agentsDir, agentId, "sessions", "sessions.json");
    const sessions = safeJSON(sessFile) || {};
    for (const [key, val] of Object.entries(sessions)) {
      try {
        const sessionKey = canonicalizeSessionKey(agentId, key);
        mergeCanonicalSessionEntry(allSessions, {
          ...val,
          key,
          sessionKey,
          agentId,
          canonicalSpawnedBy: canonicalizeRelationshipKey(agentId, val.spawnedBy),
        });
      } catch (err) {
        invalid.push({ agentId, key, error: err.message });
      }
    }
  }
  if (invalid.length > 0) {
    return res.status(500).json({ error: "Invalid session keys in sessions.json", invalid });
  }

  const childCounts = {};
  for (const s of Object.values(allSessions)) {
    if (s.canonicalSpawnedBy && allSessions[s.canonicalSpawnedBy]) {
      childCounts[s.canonicalSpawnedBy] = (childCounts[s.canonicalSpawnedBy] || 0) + 1;
    }
  }

  const result = Object.values(allSessions).map((s) => {
    const parent = s.canonicalSpawnedBy ? allSessions[s.canonicalSpawnedBy] : null;
    const displayMeta = enrichSessionMetadata(s.key, s, { sessionKey: s.sessionKey, modelAliases });
    return {
      key: s.key,
      sessionKey: s.sessionKey,
      agentId: s.agentId,
      label: s.label || null,
      sessionId: s.sessionId,
      spawnedBy: parent ? parent.key : null,
      spawnDepth: s.spawnDepth || 0,
      updatedAt: s.updatedAt || 0,
      lastChannel: s.lastChannel || null,
      groupChannel: s.groupChannel || null,
      childCount: childCounts[s.sessionKey] || 0,
      status: getSessionStatus(s),
      ...displayMeta,
    };
  });

  const filtered = result.filter((s) => s.updatedAt && Date.now() - s.updatedAt < ONE_DAY);
  filtered.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  res.json(filtered);
});

module.exports = router;
