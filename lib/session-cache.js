const fs = require("fs");
const path = require("path");
const helpers = require("./helpers");

const CACHE_TTL_MS = 2000; // 2 seconds
const DEFAULT_MAX_CACHE_ENTRIES = 128;
const DEFAULT_MAX_DERIVED_CACHE_ENTRIES = 128;
const cache = new Map(); // key: agentId, value: { data, expiresAt }
const cacheInflight = new Map(); // key: agentId, value: Promise<object|null>
const sessionDerivationCache = new Map(); // key: agentId, value: { payload, expiresAt }
const derivationInflight = new Map(); // key: agentId, value: Promise<{ sessions: object[], invalid: object[] }>
const cacheConfig = {
  maxRawEntries: DEFAULT_MAX_CACHE_ENTRIES,
  maxDerivedEntries: DEFAULT_MAX_DERIVED_CACHE_ENTRIES,
};

let hits = 0;
let misses = 0;
let derivedHits = 0;
let derivedMisses = 0;

function markEntry(entry, at = Date.now()) {
  entry.lastAccessed = at;
}

function pruneExpired(map, now = Date.now()) {
  for (const [key, entry] of map) {
    if (!entry.expiresAt || entry.expiresAt <= now) {
      map.delete(key);
    }
  }
}

function enforceCapacity(map, max) {
  if (map.size <= max) return;
  const byAge = [...map.entries()].sort((a, b) => {
    const aAccess = a[1].lastAccessed || a[1].createdAt || 0;
    const bAccess = b[1].lastAccessed || b[1].createdAt || 0;
    return aAccess - bAccess;
  });
  const removeCount = map.size - max;
  for (let i = 0; i < removeCount; i++) {
    map.delete(byAge[i][0]);
  }
}

function cleanup(map, max, now = Date.now()) {
  pruneExpired(map, now);
  enforceCapacity(map, max);
}

function getSessionsFilePath(agentId) {
  return path.join(helpers.OPENCLAW_HOME, "agents", agentId, "sessions", "sessions.json");
}

async function getCachedSessions(agentId) {
  const now = Date.now();
  cleanup(cache, cacheConfig.maxRawEntries, now);
  const entry = cache.get(agentId);
  if (entry && now < entry.expiresAt) {
    hits++;
    markEntry(entry, now);
    return entry.data;
  }

  const existing = cacheInflight.get(agentId);
  if (existing) {
    return existing;
  }

  misses++;
  const fp = getSessionsFilePath(agentId);
  const inFlight = (async () => {
    try {
      const raw = await fs.promises.readFile(fp, "utf-8");
      const parsed = JSON.parse(raw);
      const data = parsed && typeof parsed === "object" ? parsed : {};
      cache.set(agentId, {
        data,
        expiresAt: Date.now() + CACHE_TTL_MS,
        createdAt: Date.now(),
        lastAccessed: Date.now(),
      });
      cleanup(cache, cacheConfig.maxRawEntries, Date.now());
      return data;
    } catch {
      return null;
    } finally {
      cacheInflight.delete(agentId);
    }
  })();
  cacheInflight.set(agentId, inFlight);
  return inFlight;
}

function getCachedSessionsSync(agentId) {
  const now = Date.now();
  cleanup(cache, cacheConfig.maxRawEntries, now);
  const entry = cache.get(agentId);
  if (entry && now < entry.expiresAt) {
    hits++;
    markEntry(entry, now);
    return entry.data;
  }
  misses++;
  const fp = getSessionsFilePath(agentId);
  try {
    const raw = fs.readFileSync(fp, "utf-8");
    const data = JSON.parse(raw);
    const payload = data && typeof data === "object" ? data : {};
    cache.set(agentId, {
      data: payload,
      expiresAt: now + CACHE_TTL_MS,
      createdAt: now,
      lastAccessed: now,
    });
    cleanup(cache, cacheConfig.maxRawEntries, now);
    return data;
  } catch {
    return null;
  }
}

function buildSessionEntries(agentId, sessions) {
  const modelAliases = helpers.getModelAliasMap();
  const normalized = [];
  const invalid = [];

  if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) {
    return { sessions: normalized, invalid };
  }

  for (const [key, value] of Object.entries(sessions)) {
    try {
      const sessionKey = helpers.canonicalizeSessionKey(agentId, key);
      const base = value && typeof value === "object" ? value : {};
      const {
        fullSlug: ignoredFullSlug,
        modelLabel: ignoredModelLabel,
        ...metadataInput
      } = base;
      normalized.push({
        ...base,
        agentId,
        key,
        sessionKey,
        status: helpers.getSessionStatus({ ...metadataInput, sessionKey }),
        ...helpers.enrichSessionMetadata(key, { ...metadataInput, sessionKey }, { sessionKey, modelAliases }),
      });
    } catch (error) {
      invalid.push({ agentId, key, error: error.message });
    }
  }

  normalized.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return { sessions: normalized, invalid };
}

async function getCachedSessionEntries(agentId) {
  const now = Date.now();
  cleanup(sessionDerivationCache, cacheConfig.maxDerivedEntries, now);
  const entry = sessionDerivationCache.get(agentId);
  if (entry && now < entry.expiresAt) {
    derivedHits++;
    markEntry(entry, now);
    return entry.payload;
  }

  const existing = derivationInflight.get(agentId);
  if (existing) {
    return existing;
  }

  derivedMisses++;
  const inFlight = (async () => {
    const rawReader = module.exports?.getCachedSessions || getCachedSessions;
    const raw = await rawReader(agentId);
    if (raw === null) {
      return { sessions: [], invalid: [] };
    }
    const payload = buildSessionEntries(agentId, raw);
    sessionDerivationCache.set(agentId, {
      payload,
      expiresAt: Date.now() + CACHE_TTL_MS,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
    });
    cleanup(sessionDerivationCache, cacheConfig.maxDerivedEntries, Date.now());
    return payload;
  })();

  derivationInflight.set(agentId, inFlight);
  try {
    return await inFlight;
  } finally {
    derivationInflight.delete(agentId);
  }
}

function clearSessionCache() {
  cache.clear();
  cacheInflight.clear();
  sessionDerivationCache.clear();
  derivationInflight.clear();
  hits = 0;
  misses = 0;
  derivedHits = 0;
  derivedMisses = 0;
}

function getSessionCacheStats() {
  return {
    hits,
    misses,
    derivedHits,
    derivedMisses,
    size: cache.size,
    rawSize: cache.size,
    derivedSize: sessionDerivationCache.size,
    rawInflight: cacheInflight.size,
    derivedInflight: derivationInflight.size,
    config: { ...cacheConfig },
  };
}

function setSessionCacheConfig(overrides = {}) {
  if (Number.isInteger(overrides.maxRawEntries) && overrides.maxRawEntries > 0) {
    cacheConfig.maxRawEntries = overrides.maxRawEntries;
  }
  if (Number.isInteger(overrides.maxDerivedEntries) && overrides.maxDerivedEntries > 0) {
    cacheConfig.maxDerivedEntries = overrides.maxDerivedEntries;
  }
}

module.exports = {
  getCachedSessions,
  getCachedSessionsSync,
  getCachedSessionEntries,
  clearSessionCache,
  getSessionCacheStats,
  setSessionCacheConfig,
};
