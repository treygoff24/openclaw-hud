const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_MONTH_CACHE_TTL_MS = 300000; // 5 minutes
const MIN_MONTH_CACHE_TTL_MS = 10000; // 10 seconds minimum
const MAX_MONTH_CACHE_TTL_MS = 3600000; // 1 hour maximum
const CACHE_VERSION = 1;

let cacheDirCreated = false;

function getMonthCacheTtlMs() {
  const rawTtl = Number.parseInt(process.env.HUD_USAGE_MONTH_DISK_TTL_MS, 10);
  const parsedTtl = Number.isFinite(rawTtl) ? rawTtl : DEFAULT_MONTH_CACHE_TTL_MS;
  if (parsedTtl < MIN_MONTH_CACHE_TTL_MS) return MIN_MONTH_CACHE_TTL_MS;
  if (parsedTtl > MAX_MONTH_CACHE_TTL_MS) return MAX_MONTH_CACHE_TTL_MS;
  return parsedTtl;
}

function getOpenclawHome() {
  // Read dynamically from helpers module exports so mutations (including tests) take effect
  return require("./helpers").OPENCLAW_HOME;
}

function ensureCacheDir() {
  const cacheDir = path.join(getOpenclawHome(), "hud-cache", "monthly");
  if (!cacheDirCreated || !fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
    cacheDirCreated = true;
  }
  return cacheDir;
}

function sanitizeCacheKey(key) {
  return String(key)
    .replace(/[\\/]/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 200);
}

function getMonthCachePath(cacheKey) {
  const sanitizedKey = sanitizeCacheKey(cacheKey);
  const cacheDir = ensureCacheDir();
  return path.join(cacheDir, `${sanitizedKey}.json`);
}

function generateMonthCacheKey({
  tz,
  monthStartMs,
  pricingFingerprint,
  sessionsLimit,
  monthMaxWindows,
  monthMaxDurationMs,
}) {
  const data = {
    tz,
    monthStartMs,
    pricingFingerprint,
    sessionsLimit,
    monthMaxWindows,
    monthMaxDurationMs,
  };
  const hash = crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
  return `month-${hash.slice(0, 32)}`;
}

function writeMonthCache(cacheKey, payload) {
  try {
    const cachePath = getMonthCachePath(cacheKey);
    const tmpPath = cachePath + ".tmp";
    const cacheEntry = {
      version: CACHE_VERSION,
      timestamp: Date.now(),
      payload,
    };
    // Atomic write: write to temp file, then rename
    fs.writeFileSync(tmpPath, JSON.stringify(cacheEntry));
    fs.renameSync(tmpPath, cachePath);
    return true;
  } catch (err) {
    console.warn("[month-usage-cache] Failed to write cache", {
      cacheKey,
      error: err.message,
    });
    return false;
  }
}

/**
 * Read a cached monthly usage entry. Returns `{ payload, timestamp }` if the
 * cache file exists and is valid, or `null` otherwise.
 */
function readMonthCacheEntry(cacheKey) {
  try {
    const cachePath = getMonthCachePath(cacheKey);
    if (!fs.existsSync(cachePath)) {
      return null;
    }

    const content = fs.readFileSync(cachePath, "utf8");
    const cacheEntry = JSON.parse(content);

    if (!cacheEntry || cacheEntry.version !== CACHE_VERSION || !cacheEntry.payload) {
      return null;
    }

    return { payload: cacheEntry.payload, timestamp: cacheEntry.timestamp };
  } catch (err) {
    console.warn("[month-usage-cache] Failed to read cache", {
      cacheKey,
      error: err.message,
    });
    return null;
  }
}

/**
 * Read cached payload only (convenience wrapper).
 */
function readMonthCache(cacheKey) {
  const entry = readMonthCacheEntry(cacheKey);
  return entry ? entry.payload : null;
}

/**
 * Read the cache timestamp only (convenience wrapper).
 */
function getCacheTimestamp(cacheKey) {
  const entry = readMonthCacheEntry(cacheKey);
  return entry ? entry.timestamp : null;
}

/**
 * Read the cache and check TTL in a single file read. Returns the payload
 * if the cache is valid and fresh, or `null` otherwise.
 */
function readFreshMonthCache(cacheKey, nowMs = Date.now(), ttlMs = null) {
  const effectiveTtlMs = ttlMs || getMonthCacheTtlMs();
  const entry = readMonthCacheEntry(cacheKey);
  if (!entry) return null;
  const ageMs = nowMs - entry.timestamp;
  if (ageMs >= effectiveTtlMs) return null;
  return entry.payload;
}

function shouldUseMonthCache(cacheKey, nowMs = Date.now(), ttlMs = null) {
  return readFreshMonthCache(cacheKey, nowMs, ttlMs) !== null;
}

function invalidateMonthCache(cacheKey) {
  try {
    const cachePath = getMonthCachePath(cacheKey);
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
      return true;
    }
    return false;
  } catch (err) {
    console.warn("[month-usage-cache] Failed to invalidate cache", {
      cacheKey,
      error: err.message,
    });
    return false;
  }
}

function clearAllMonthCaches() {
  try {
    const cacheDir = ensureCacheDir();
    const files = fs.readdirSync(cacheDir);
    let cleared = 0;

    for (const file of files) {
      if (file.endsWith(".json") || file.endsWith(".json.tmp")) {
        try {
          fs.unlinkSync(path.join(cacheDir, file));
          cleared++;
        } catch (e) {
          // Ignore individual file errors
        }
      }
    }

    return cleared;
  } catch (err) {
    console.warn("[month-usage-cache] Failed to clear caches", {
      error: err.message,
    });
    return 0;
  }
}

module.exports = {
  getMonthCachePath,
  generateMonthCacheKey,
  writeMonthCache,
  readMonthCache,
  readMonthCacheEntry,
  readFreshMonthCache,
  getMonthCacheTtlMs,
  shouldUseMonthCache,
  invalidateMonthCache,
  clearAllMonthCaches,
  getCacheTimestamp,
};
