const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeMs(value) {
  if (!isFiniteNumber(value) || value <= 0) return 0;
  return Math.max(0, value);
}

function normalizeTtlMs(ttlMs) {
  if (!isFiniteNumber(ttlMs) || ttlMs < 0) return 0;
  return Math.floor(ttlMs);
}

function dedupePaths(paths) {
  const seen = new Set();
  const out = [];

  for (const inputPath of paths) {
    if (typeof inputPath !== "string") continue;
    const normalized = path.normalize(inputPath);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function readDependency(pathName) {
  try {
    const stat = fs.statSync(pathName);
    return {
      path: pathName,
      exists: true,
      size: isFiniteNumber(stat.size) ? stat.size : null,
      mtimeMs: isFiniteNumber(stat.mtimeMs) ? Math.floor(stat.mtimeMs) : null,
    };
  } catch (_error) {
    return {
      path: pathName,
      exists: false,
      size: null,
      mtimeMs: null,
    };
  }
}

function normalizeDependencyRows(rows) {
  return rows
    .map((row) => ({
      path: String(row.path || ""),
      exists: Boolean(row.exists),
      size: isFiniteNumber(row.size) ? row.size : null,
      mtimeMs: isFiniteNumber(row.mtimeMs) ? row.mtimeMs : null,
    }))
    .filter((row) => row.path)
    .sort((left, right) => left.path.localeCompare(right.path));
}

function collectDependencyRows(paths) {
  const normalizedPaths = dedupePaths(paths);
  if (normalizedPaths.length === 0) return [];

  const rows = [];
  for (const filePath of normalizedPaths) {
    rows.push(readDependency(filePath));
  }

  return normalizeDependencyRows(rows);
}

function areDependencyRowsEqual(leftRows, rightRows) {
  if (leftRows.length !== rightRows.length) return false;

  for (let i = 0; i < leftRows.length; i += 1) {
    const left = leftRows[i];
    const right = rightRows[i];

    if (left.path !== right.path) return false;
    if (left.exists !== right.exists) return false;
    if (!left.exists) continue;

    if (left.size !== right.size) return false;
    if (left.mtimeMs !== right.mtimeMs) return false;
  }

  return true;
}

function buildCacheStateString(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return "idle";
  }

  const source = entries
    .map((entry) => {
      const row = entry || {};
      const rowPath = typeof row.path === "string" ? row.path : "";
      const exists = row.exists ? "1" : "0";
      const size = Number.isFinite(row.size) ? String(row.size) : "na";
      const mtimeMs = Number.isFinite(row.mtimeMs) ? String(Math.floor(row.mtimeMs)) : "na";
      return `${rowPath}:${exists}:${size}:${mtimeMs}`;
    })
    .sort()
    .join("|");

  if (!source) {
    return "idle";
  }

  return crypto.createHash("sha1").update(source).digest("hex").slice(0, 16);
}

function createInProcessMemoCache({ name = "inprocess-memo-cache" } = {}) {
  const cache = new Map();
  const watchers = new Map();

  function resolveKey(key) {
    return typeof key === "string" ? key : String(key);
  }

  function shouldUseCache(ttlMs) {
    return isFiniteNumber(ttlMs) && ttlMs > 0;
  }

  function watchPath(filePath, onChange) {
    if (typeof onChange !== "function") return null;

    try {
      const watcher = fs.watch(filePath, { persistent: false }, () => {
        onChange(filePath);
      });
      return watcher;
    } catch (_error) {
      return null;
    }
  }

  async function getOrSet({
    key,
    ttlMs = 0,
    nowMs = Date.now(),
    getDependencyPaths,
    loader,
  }) {
    const cacheKey = resolveKey(key);
    const resolvedTtlMs = normalizeTtlMs(ttlMs);
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();

    if (typeof cacheKey !== "string" || cacheKey.length === 0) {
      throw new Error("in-process memo cache key must be a non-empty value");
    }

    if (typeof loader !== "function") {
      throw new Error("in-process memo cache requires a loader function");
    }

    const existing = cache.get(cacheKey);
    if (existing && shouldUseCache(resolvedTtlMs)) {
      const dependencyRows = collectDependencyRows(existing.dependencyPaths);
      const stillValid =
        now < existing.expiresAt && areDependencyRowsEqual(existing.dependencyRows, dependencyRows);

      if (stillValid) {
        return {
          fromCache: true,
          value: existing.value,
          cacheMeta: existing.cacheMeta,
          cacheState: {
            state: "hit",
            cacheName: name,
            key: cacheKey,
            ageMs: now - existing.createdAt,
            expiresAtMs: existing.expiresAt,
            ttlMs: resolvedTtlMs,
            dependencyHash: buildCacheStateString(existing.dependencyRows),
            dependencyCount: existing.dependencyRows.length,
          },
        };
      }

      const reason = now >= existing.expiresAt ? "expired" : "dependency-change";
      if (existing?.metaResetReason !== reason) {
        existing.metaResetReason = reason;
      }
    }

    const computeStartMs = Number(performance.now());
    const computeResult = await loader();
    const computedValue =
      computeResult && typeof computeResult === "object" && "value" in computeResult
        ? computeResult.value
        : computeResult;
    const dependencyPaths =
      computeResult && Object.prototype.hasOwnProperty.call(computeResult, "dependencyPaths")
        ? computeResult.dependencyPaths
        : typeof getDependencyPaths === "function"
          ? getDependencyPaths(computedValue)
          : [];
    const dependencyRows = collectDependencyRows(dependencyPaths);
    const cacheMeta =
      computeResult && typeof computeResult === "object" && Object.prototype.hasOwnProperty.call(computeResult, "cacheMeta")
        ? computeResult.cacheMeta
        : {};
    const computeMs = Number(performance.now()) - computeStartMs;

    const entry = {
      value: computedValue,
      dependencyPaths: dedupePaths(dependencyPaths),
      dependencyRows,
      cacheMeta: Object.assign({ computeMs }, cacheMeta),
      createdAt: now,
      expiresAt: now + resolvedTtlMs,
      cacheKey,
      key: cacheKey,
      state: "fresh",
      lastState: existing ? existing.state : null,
    };

    if (shouldUseCache(resolvedTtlMs)) {
      entry.state = "fresh";
      cache.set(cacheKey, entry);
    } else {
      cache.delete(cacheKey);
    }

    return {
      fromCache: false,
      value: computedValue,
      cacheMeta: entry.cacheMeta,
      cacheState: {
        state: existing ? "stale" : "miss",
        cacheName: name,
        key: cacheKey,
        ageMs: 0,
        ttlMs: resolvedTtlMs,
        expiresAtMs: shouldUseCache(resolvedTtlMs) ? entry.expiresAt : now,
        dependencyHash: buildCacheStateString(dependencyRows),
        dependencyCount: dependencyRows.length,
      },
    };
  }

  function invalidate(key) {
    if (typeof key === "undefined" || key === null) {
      cache.clear();
      return;
    }
    cache.delete(resolveKey(key));
  }

  function getState(key) {
    const cached = cache.get(resolveKey(key));
    if (!cached) {
      return {
        state: "miss",
        cacheName: name,
      };
    }

    return {
      state: cached.state,
      cacheName: name,
      ageMs: Date.now() - cached.createdAt,
      expiresAtMs: cached.expiresAt,
      dependencyCount: cached.dependencyRows.length,
      dependencyHash: buildCacheStateString(cached.dependencyRows),
    };
  }

  function setWatchers(paths, onPathChange) {
    if (!Array.isArray(paths) || paths.length === 0) return () => {};

    const watchList = dedupePaths(paths);
    const disposables = [];

    for (const watchPathName of watchList) {
      const existing = watchers.get(watchPathName);
      if (existing?.watcher) {
        disposables.push(() => {});
        continue;
      }

      const watcher = watchPath(watchPathName, () => {
        onPathChange(watchPathName);
      });

      if (!watcher) {
        continue;
      }

      watchers.set(watchPathName, {
        watcher,
        refCount: 1,
      });

      disposables.push(() => {
        const existingWatch = watchers.get(watchPathName);
        if (!existingWatch) return;
        try {
          existingWatch.watcher.close();
        } catch (_error) {}
        watchers.delete(watchPathName);
      });
    }

    return () => {
      for (const dispose of disposables) {
        try {
          dispose();
        } catch (_error) {
          // ignore
        }
      }
    };
  }

  function clear() {
    cache.clear();
    for (const entry of watchers.values()) {
      try {
        entry.watcher.close();
      } catch (_error) {}
    }
    watchers.clear();
  }

  return {
    getOrSet,
    invalidate,
    getState,
    setWatchers,
    clear,
  };
}

module.exports = {
  createInProcessMemoCache,
};
