const fs = require("fs");
const path = require("path");
const { OPENCLAW_HOME } = require("./helpers");

const CACHE_TTL_MS = 2000; // 2 seconds
const cache = new Map(); // key: agentId, value: { data, expiresAt }

let hits = 0;
let misses = 0;

function getSessionsFilePath(agentId) {
  return path.join(OPENCLAW_HOME, "agents", agentId, "sessions", "sessions.json");
}

async function getCachedSessions(agentId) {
  const now = Date.now();
  const entry = cache.get(agentId);
  if (entry && now < entry.expiresAt) {
    hits++;
    return entry.data;
  }
  misses++;
  const fp = getSessionsFilePath(agentId);
  try {
    const raw = await fs.promises.readFile(fp, "utf-8");
    const data = JSON.parse(raw);
    cache.set(agentId, { data, expiresAt: now + CACHE_TTL_MS });
    return data;
  } catch {
    return null;
  }
}

function getCachedSessionsSync(agentId) {
  const now = Date.now();
  const entry = cache.get(agentId);
  if (entry && now < entry.expiresAt) {
    hits++;
    return entry.data;
  }
  misses++;
  const fp = getSessionsFilePath(agentId);
  try {
    const raw = fs.readFileSync(fp, "utf-8");
    const data = JSON.parse(raw);
    cache.set(agentId, { data, expiresAt: now + CACHE_TTL_MS });
    return data;
  } catch {
    return null;
  }
}

function clearSessionCache() {
  cache.clear();
  hits = 0;
  misses = 0;
}

function getSessionCacheStats() {
  return { hits, misses, size: cache.size };
}

module.exports = {
  getCachedSessions,
  getCachedSessionsSync,
  clearSessionCache,
  getSessionCacheStats,
};
