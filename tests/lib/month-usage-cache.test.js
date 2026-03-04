import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

const originalOpenclawHome = process.env.OPENCLAW_HOME;

describe("month-usage-cache", () => {
  let testDir;
  let cacheModule;

  beforeEach(() => {
    testDir = path.join("/tmp", `hud-cache-test-${Date.now()}`);
    process.env.OPENCLAW_HOME = testDir;

    // Clear require cache and reload module with new OPENCLAW_HOME
    delete require.cache[require.resolve("../../lib/month-usage-cache")];
    delete require.cache[require.resolve("../../lib/helpers")];
    cacheModule = require("../../lib/month-usage-cache");
  });

  afterEach(() => {
    process.env.OPENCLAW_HOME = originalOpenclawHome;
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch (e) {
      // ignore cleanup errors
    }
  });

  describe("getMonthCachePath", () => {
    it("returns path within OPENCLAW_HOME/hud-cache/monthly/", () => {
      const cacheKey = "test-key-123";
      const cachePath = cacheModule.getMonthCachePath(cacheKey);

      expect(cachePath).toContain("hud-cache");
      expect(cachePath).toContain("monthly");
      expect(cachePath).toContain(cacheKey);
      expect(cachePath).toMatch(/\.json$/);
    });

    it("creates hud-cache directory if it doesn't exist", () => {
      const cacheKey = "new-cache";
      cacheModule.getMonthCachePath(cacheKey);

      const hudCacheDir = path.join(testDir, "hud-cache");
      expect(fs.existsSync(hudCacheDir)).toBe(true);
    });

    it("sanitizes cache key to prevent directory traversal", () => {
      const maliciousKey = "../../../etc/passwd";
      const cachePath = cacheModule.getMonthCachePath(maliciousKey);

      // Should not contain path traversal
      expect(cachePath).not.toContain("../");
      expect(cachePath).toContain("etc-passwd"); // Sanitized version
    });
  });

  describe("generateMonthCacheKey", () => {
    it("generates consistent hash from parameters", () => {
      const params = {
        tz: "America/Chicago",
        monthStartMs: 1704067200000,
        pricingFingerprint: "v1",
        sessionsLimit: 500,
      };

      const key1 = cacheModule.generateMonthCacheKey(params);
      const key2 = cacheModule.generateMonthCacheKey(params);

      expect(key1).toBe(key2);
      expect(typeof key1).toBe("string");
      expect(key1.length).toBeGreaterThan(0);
    });

    it("generates different keys for different parameters", () => {
      const key1 = cacheModule.generateMonthCacheKey({
        tz: "America/Chicago",
        monthStartMs: 1704067200000,
        pricingFingerprint: "v1",
        sessionsLimit: 500,
      });

      const key2 = cacheModule.generateMonthCacheKey({
        tz: "America/New_York", // Different TZ
        monthStartMs: 1704067200000,
        pricingFingerprint: "v1",
        sessionsLimit: 500,
      });

      expect(key1).not.toBe(key2);
    });
  });

  describe("writeMonthCache", () => {
    it("writes cache file with payload and metadata", () => {
      const cacheKey = "test-write";
      const payload = {
        usageRows: [{ model: "gpt-4", cost: 10 }],
        diagnostics: { isPartial: false },
      };

      cacheModule.writeMonthCache(cacheKey, payload);

      const cachePath = cacheModule.getMonthCachePath(cacheKey);
      expect(fs.existsSync(cachePath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      expect(content.payload).toEqual(payload);
      expect(content.timestamp).toBeDefined();
      expect(content.version).toBe(1);
    });

    it("overwrites existing cache file", () => {
      const cacheKey = "test-overwrite";

      cacheModule.writeMonthCache(cacheKey, { data: "old" });
      cacheModule.writeMonthCache(cacheKey, { data: "new" });

      const cachePath = cacheModule.getMonthCachePath(cacheKey);
      const content = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      expect(content.payload.data).toBe("new");
    });
  });

  describe("readMonthCache", () => {
    it("returns null for non-existent cache", () => {
      const result = cacheModule.readMonthCache("non-existent-key");
      expect(result).toBeNull();
    });

    it("returns parsed payload for valid cache", () => {
      const cacheKey = "test-read";
      const payload = {
        usageRows: [{ model: "gpt-4", cost: 25 }],
        diagnostics: { isPartial: true, reason: "timeout" },
      };

      cacheModule.writeMonthCache(cacheKey, payload);

      const result = cacheModule.readMonthCache(cacheKey);
      expect(result).toEqual(payload);
    });

    it("returns null for corrupted cache file", () => {
      const cacheKey = "corrupted";
      const cachePath = cacheModule.getMonthCachePath(cacheKey);

      fs.writeFileSync(cachePath, "not valid json");

      const result = cacheModule.readMonthCache(cacheKey);
      expect(result).toBeNull();
    });
  });

  describe("getMonthCacheTtlMs", () => {
    it("returns default 5 minutes when env not set", () => {
      delete process.env.HUD_USAGE_MONTH_DISK_TTL_MS;
      // Reload module to pick up default
      delete require.cache[require.resolve("../../lib/month-usage-cache")];
      const freshModule = require("../../lib/month-usage-cache");
      expect(freshModule.getMonthCacheTtlMs()).toBe(300000);
    });

    it("returns configured value from env", () => {
      process.env.HUD_USAGE_MONTH_DISK_TTL_MS = "60000";
      // Reload module to pick up new env
      delete require.cache[require.resolve("../../lib/month-usage-cache")];
      const freshModule = require("../../lib/month-usage-cache");
      expect(freshModule.getMonthCacheTtlMs()).toBe(60000);
    });

    it("clamps to minimum 10 seconds", () => {
      process.env.HUD_USAGE_MONTH_DISK_TTL_MS = "1000";
      delete require.cache[require.resolve("../../lib/month-usage-cache")];
      const freshModule = require("../../lib/month-usage-cache");
      expect(freshModule.getMonthCacheTtlMs()).toBe(10000);
    });

    it("clamps to maximum 1 hour", () => {
      process.env.HUD_USAGE_MONTH_DISK_TTL_MS = "7200000";
      delete require.cache[require.resolve("../../lib/month-usage-cache")];
      const freshModule = require("../../lib/month-usage-cache");
      expect(freshModule.getMonthCacheTtlMs()).toBe(3600000);
    });
  });

  describe("shouldUseMonthCache", () => {
    it("returns false when cache file doesn't exist", () => {
      expect(cacheModule.shouldUseMonthCache("non-existent", Date.now())).toBe(false);
    });

    it("returns true for fresh cache", () => {
      const cacheKey = "fresh-cache";
      cacheModule.writeMonthCache(cacheKey, { data: "test" });

      expect(cacheModule.shouldUseMonthCache(cacheKey, Date.now())).toBe(true);
    });

    it("returns false for expired cache", () => {
      const cacheKey = "expired-cache";
      cacheModule.writeMonthCache(cacheKey, { data: "test" });

      const futureTime = Date.now() + 400000; // 400 seconds in future
      expect(cacheModule.shouldUseMonthCache(cacheKey, futureTime, 300000)).toBe(false);
    });

    it("respects custom TTL", () => {
      const cacheKey = "custom-ttl";
      cacheModule.writeMonthCache(cacheKey, { data: "test" });

      // Cache is 10 seconds old, but TTL is 30 seconds
      const tenSecondsLater = Date.now() + 10000;
      expect(cacheModule.shouldUseMonthCache(cacheKey, tenSecondsLater, 30000)).toBe(true);
    });
  });

  describe("readFreshMonthCache", () => {
    it("returns payload for fresh cache entry", () => {
      const cacheKey = "fresh-read";
      const payload = { models: [{ model: "gpt-5", totalCost: 42 }] };
      cacheModule.writeMonthCache(cacheKey, payload);

      const result = cacheModule.readFreshMonthCache(cacheKey, Date.now(), 300000);
      expect(result).toEqual(payload);
    });

    it("returns null when cache entry is expired", () => {
      const cacheKey = "expired-read";
      cacheModule.writeMonthCache(cacheKey, { data: "old" });

      const farFuture = Date.now() + 600000;
      const result = cacheModule.readFreshMonthCache(cacheKey, farFuture, 300000);
      expect(result).toBeNull();
    });

    it("returns null when no cache file exists", () => {
      const result = cacheModule.readFreshMonthCache("no-such-key", Date.now(), 300000);
      expect(result).toBeNull();
    });
  });

  describe("getCacheTimestamp", () => {
    it("returns timestamp of a written cache entry", () => {
      const cacheKey = "ts-test";
      const beforeWrite = Date.now();
      cacheModule.writeMonthCache(cacheKey, { data: "timestamped" });
      const afterWrite = Date.now();

      const ts = cacheModule.getCacheTimestamp(cacheKey);
      expect(ts).toBeGreaterThanOrEqual(beforeWrite);
      expect(ts).toBeLessThanOrEqual(afterWrite);
    });

    it("returns null for non-existent cache", () => {
      const ts = cacheModule.getCacheTimestamp("missing-key");
      expect(ts).toBeNull();
    });
  });

  describe("invalidateMonthCache", () => {
    it("removes an existing cache file and returns true", () => {
      const cacheKey = "to-invalidate";
      cacheModule.writeMonthCache(cacheKey, { data: "remove me" });

      const removed = cacheModule.invalidateMonthCache(cacheKey);
      expect(removed).toBe(true);

      const result = cacheModule.readMonthCache(cacheKey);
      expect(result).toBeNull();
    });

    it("returns false when cache file does not exist", () => {
      const removed = cacheModule.invalidateMonthCache("never-written");
      expect(removed).toBe(false);
    });
  });

  describe("clearAllMonthCaches", () => {
    it("removes all cache files and returns count", () => {
      cacheModule.writeMonthCache("clear-a", { a: 1 });
      cacheModule.writeMonthCache("clear-b", { b: 2 });
      cacheModule.writeMonthCache("clear-c", { c: 3 });

      const cleared = cacheModule.clearAllMonthCaches();
      expect(cleared).toBe(3);

      expect(cacheModule.readMonthCache("clear-a")).toBeNull();
      expect(cacheModule.readMonthCache("clear-b")).toBeNull();
      expect(cacheModule.readMonthCache("clear-c")).toBeNull();
    });

    it("returns 0 when cache directory is empty", () => {
      const cleared = cacheModule.clearAllMonthCaches();
      expect(cleared).toBe(0);
    });

    it("also removes .tmp files", () => {
      // Write a cache entry then manually create a .tmp leftover
      cacheModule.writeMonthCache("tmp-test", { data: "x" });
      const cachePath = cacheModule.getMonthCachePath("tmp-test");
      fs.writeFileSync(cachePath + ".tmp", "leftover");

      const cleared = cacheModule.clearAllMonthCaches();
      expect(cleared).toBe(2); // .json + .json.tmp
      expect(fs.existsSync(cachePath)).toBe(false);
      expect(fs.existsSync(cachePath + ".tmp")).toBe(false);
    });
  });
});
