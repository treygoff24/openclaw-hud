const path = require("path");
const { Router } = require("express");
const {
  OPENCLAW_HOME,
  safeReaddirAsync,
  safeReadAsync,
  canonicalizeRelationshipKey,
} = require("../lib/helpers");
const { tailLines } = require("../lib/tail-reader");
const { getCachedSessionEntries } = require("../lib/session-cache");
const crypto = require("crypto");

const router = Router();
const sessionsDeps = {
  safeReaddirAsync,
  safeReadAsync,
  tailLines,
  canonicalizeRelationshipKey,
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

function setSessionsDependencies(overrides = {}) {
  Object.assign(sessionsDeps, overrides);
}

const ONE_DAY = 24 * 60 * 60 * 1000;
const CANONICAL_SESSION_KEY_RE = /^agent:[a-zA-Z0-9_-]+:[a-zA-Z0-9:_-]+$/;
const WARNING_CODE_INVALID_SESSION_KEYS = "INVALID_SESSION_KEYS";

function attachSessionWarningHeaders(res, routeName, invalid) {
  if (!Array.isArray(invalid) || invalid.length === 0) return;
  const sample = invalid.slice(0, 5).map((entry) => ({
    agentId: entry.agentId,
    key: entry.key,
    error: entry.error,
  }));
  res.set("x-openclaw-warning-code", WARNING_CODE_INVALID_SESSION_KEYS);
  res.set("x-openclaw-warning-count", String(invalid.length));
  res.set("x-openclaw-warning-route", routeName);
  res.set(
    "x-openclaw-warning-sample",
    Buffer.from(JSON.stringify(sample), "utf8").toString("base64url"),
  );
}

function mergeCanonicalSessionEntry(allSessions, candidate) {
  const existing = allSessions[candidate.sessionKey];
  if (!existing) {
    allSessions[candidate.sessionKey] = candidate;
    return;
  }

  const existingIsCanonical = CANONICAL_SESSION_KEY_RE.test(existing.key);
  const candidateIsCanonical = CANONICAL_SESSION_KEY_RE.test(candidate.key);

  if (!existingIsCanonical && candidateIsCanonical) {
    allSessions[candidate.sessionKey] = candidate;
  }
}

function parseSessionLogLines(lines) {
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {}
  }
  return entries;
}

router.get("/api/sessions", async (req, res) => {
  const agentsDir = path.join(OPENCLAW_HOME, "agents");
  const agents = await sessionsDeps.safeReaddirAsync(agentsDir);
  const all = [];
  const invalid = [];

  const perAgent = await Promise.all(
    agents.map(async (agentId) => ({
      agentId,
      ...(await sessionsDeps.getCachedSessionEntries(agentId)),
    })),
  );

  for (const entry of perAgent) {
    const invalidEntries = Array.isArray(entry.invalid) ? entry.invalid : [];
    if (invalidEntries.length) {
      invalid.push(...invalidEntries);
    }
    for (const val of entry.sessions) {
      all.push(val);
    }
  }

  attachSessionWarningHeaders(res, "/api/sessions", invalid);
  const now = Date.now();
  const recent = all.filter((s) => s.updatedAt && now - s.updatedAt < ONE_DAY);
  recent.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  sendJsonWithETag(req, res, recent.slice(0, 100));
});

router.get("/api/session-log/:agentId/:sessionId", async (req, res) => {
  const { agentId, sessionId } = req.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(agentId) || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    return res.status(400).json({ error: "Invalid parameters" });
  }
  const limit = parseInt(req.query.limit) || 50;
  const logFile = path.join(OPENCLAW_HOME, "agents", agentId, "sessions", `${sessionId}.jsonl`);
  if (Number.isFinite(limit) && limit > 0) {
    const lines = await sessionsDeps.tailLines(logFile, limit);
    return res.json(parseSessionLogLines(lines));
  }

  const raw = await sessionsDeps.safeReadAsync(logFile);
  if (!raw) return res.json([]);
  const lines = raw.trim().split("\n").filter(Boolean);
  return res.json(parseSessionLogLines(lines.slice(-limit)));
});

router.get("/api/session-tree", async (req, res) => {
  const agentsDir = path.join(OPENCLAW_HOME, "agents");
  const agents = await sessionsDeps.safeReaddirAsync(agentsDir);
  const allSessions = {};
  const invalid = [];

  const perAgent = await Promise.all(
    agents.map(async (agentId) => ({
      agentId,
      ...(await sessionsDeps.getCachedSessionEntries(agentId)),
    })),
  );

  for (const entry of perAgent) {
    const invalidEntries = Array.isArray(entry.invalid) ? entry.invalid : [];
    if (invalidEntries.length) {
      invalid.push(...invalidEntries);
    }
    for (const val of entry.sessions) {
      mergeCanonicalSessionEntry(allSessions, {
        ...val,
        canonicalSpawnedBy: sessionsDeps.canonicalizeRelationshipKey(entry.agentId, val.spawnedBy),
      });
    }
  }
  attachSessionWarningHeaders(res, "/api/session-tree", invalid);

  const childCounts = {};
  for (const s of Object.values(allSessions)) {
    if (s.canonicalSpawnedBy && allSessions[s.canonicalSpawnedBy]) {
      childCounts[s.canonicalSpawnedBy] = (childCounts[s.canonicalSpawnedBy] || 0) + 1;
    }
  }

  const result = Object.values(allSessions).map((s) => {
    const parent = s.canonicalSpawnedBy ? allSessions[s.canonicalSpawnedBy] : null;
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
      status: s.status,
      sessionRole: s.sessionRole,
      sessionAlias: s.sessionAlias,
      modelLabel: s.modelLabel,
      fullSlug: s.fullSlug,
    };
  });

  const now = Date.now();
  const filtered = result.filter((s) => s.updatedAt && now - s.updatedAt < ONE_DAY);
  filtered.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  sendJsonWithETag(req, res, filtered);
});

router.__setDependencies = setSessionsDependencies;

module.exports = router;
