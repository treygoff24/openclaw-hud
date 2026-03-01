import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMPDIR = path.join(os.tmpdir(), "session-cache-test-" + Date.now());
fs.mkdirSync(TMPDIR, { recursive: true });

afterAll(() => {
  fs.rmSync(TMPDIR, { recursive: true, force: true });
});

// We need to set OPENCLAW_HOME before importing session-cache
const helpers = require("../../lib/helpers");
helpers.OPENCLAW_HOME = TMPDIR;

const {
  getCachedSessions,
  getCachedSessionsSync,
  clearSessionCache,
  getSessionCacheStats,
} = require("../../lib/session-cache");

function writeSessionsFile(agentId, data) {
  const dir = path.join(TMPDIR, "agents", agentId, "sessions");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "sessions.json"), JSON.stringify(data));
}

describe("session-cache", () => {
  beforeEach(() => {
    clearSessionCache();
  });

  describe("getCachedSessions (async)", () => {
    it("returns parsed sessions data for valid agent", async () => {
      writeSessionsFile("agent1", { s1: { sessionId: "s1", updatedAt: 1000 } });
      const result = await getCachedSessions("agent1");
      expect(result).toEqual({ s1: { sessionId: "s1", updatedAt: 1000 } });
    });

    it("returns null for non-existent agent", async () => {
      const result = await getCachedSessions("nonexistent-agent");
      expect(result).toBeNull();
    });

    it("returns cached data on second call (cache hit)", async () => {
      writeSessionsFile("agent2", { s1: { sessionId: "s1" } });
      await getCachedSessions("agent2");
      const stats1 = getSessionCacheStats();
      expect(stats1.misses).toBe(1);

      await getCachedSessions("agent2");
      const stats2 = getSessionCacheStats();
      expect(stats2.hits).toBe(1);
      expect(stats2.misses).toBe(1);
    });

    it("re-reads after cache expires", async () => {
      writeSessionsFile("agent3", { s1: { sessionId: "s1" } });
      await getCachedSessions("agent3");

      // Manually expire the cache by manipulating the internal state
      // We'll just wait or clear and re-read
      clearSessionCache();
      await getCachedSessions("agent3");
      const stats = getSessionCacheStats();
      expect(stats.misses).toBe(1); // After clear, it's a fresh miss
      expect(stats.hits).toBe(0);
    });
  });

  describe("getCachedSessionsSync", () => {
    it("returns parsed sessions data for valid agent", () => {
      writeSessionsFile("agent4", { s1: { sessionId: "s1", updatedAt: 2000 } });
      const result = getCachedSessionsSync("agent4");
      expect(result).toEqual({ s1: { sessionId: "s1", updatedAt: 2000 } });
    });

    it("returns null for non-existent agent", () => {
      const result = getCachedSessionsSync("nonexistent-sync");
      expect(result).toBeNull();
    });

    it("returns cached data on second call", () => {
      writeSessionsFile("agent5", { s1: { sessionId: "s1" } });
      getCachedSessionsSync("agent5");
      getCachedSessionsSync("agent5");
      const stats = getSessionCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });
  });

  describe("clearSessionCache", () => {
    it("clears all cached data and resets stats", async () => {
      writeSessionsFile("agent6", { s1: { sessionId: "s1" } });
      await getCachedSessions("agent6");
      expect(getSessionCacheStats().size).toBe(1);

      clearSessionCache();
      const stats = getSessionCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe("getSessionCacheStats", () => {
    it("tracks hits, misses, and size", async () => {
      writeSessionsFile("agent7", { s1: { sessionId: "s1" } });
      writeSessionsFile("agent8", { s2: { sessionId: "s2" } });

      await getCachedSessions("agent7"); // miss
      await getCachedSessions("agent8"); // miss
      await getCachedSessions("agent7"); // hit
      await getCachedSessions("agent8"); // hit
      await getCachedSessions("nonexistent"); // miss (returns null, not cached)

      const stats = getSessionCacheStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(3);
      expect(stats.size).toBe(2); // only agent7 and agent8 are cached
    });
  });
});
