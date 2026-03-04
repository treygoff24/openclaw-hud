const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Router } = require("express");
const { OPENCLAW_HOME, safeReaddirAsync } = require("../lib/helpers");
const { getCachedSessionEntries } = require("../lib/session-cache");

const router = Router();
const agentsDeps = {
  safeReaddirAsync,
  getCachedSessionEntries,
};

function parseIfNoneMatchHeader(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((value) => value.replace(/^W\//, ""));
}

function isIfNoneMatch(req, etag) {
  const ifNoneMatch = req?.headers?.["if-none-match"] || req?.get?.("if-none-match");
  const candidates = parseIfNoneMatchHeader(ifNoneMatch);
  const normalizedEtag = String(etag || "").replace(/^W\//, "");
  return candidates.includes(normalizedEtag);
}

function buildStableEtag(payload) {
  const serialized = JSON.stringify(payload);
  const digest = crypto.createHash("sha256").update(serialized).digest("base64url");
  return `"${digest}"`;
}

function sendJsonWithETag(req, res, payload) {
  const etag = buildStableEtag(payload);
  res.set("ETag", etag);
  if (isIfNoneMatch(req, etag)) {
    return res.sendStatus(304);
  }
  return res.json(payload);
}

function setAgentsDependencies(overrides = {}) {
  Object.assign(agentsDeps, overrides);
}

router.get("/api/agents", async (req, res) => {
  const agentsDir = path.join(OPENCLAW_HOME, "agents");
  const allEntries = await agentsDeps.safeReaddirAsync(agentsDir);
  const candidateAgents = await Promise.all(
    allEntries.map(async (entry) => {
      try {
        const stat = await fs.promises.stat(path.join(agentsDir, entry));
        return stat.isDirectory() ? entry : null;
      } catch {
        return null;
      }
    }),
  );
  const agents = candidateAgents.filter(Boolean);

  const now = Date.now();
  const result = await Promise.all(
    agents.map(async (id) => {
      const { sessions: sessionList } = await agentsDeps.getCachedSessionEntries(id);
      const sorted = [...sessionList].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      let activeSessions = 0;
      for (const session of sessionList) {
        if (session.updatedAt && now - session.updatedAt < 3600000) {
          activeSessions += 1;
        }
      }
      return { id, sessions: sorted, sessionCount: sessionList.length, activeSessions };
    }),
  );

  result.sort((a, b) => {
    const aMax = a.sessions[0]?.updatedAt || 0;
    const bMax = b.sessions[0]?.updatedAt || 0;
    return bMax - aMax;
  });
  sendJsonWithETag(req, res, result);
});

router.__setDependencies = setAgentsDependencies;

module.exports = router;
