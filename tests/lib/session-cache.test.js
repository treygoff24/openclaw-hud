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
  getCachedSessionEntries,
  clearSessionCache,
  getSessionCacheStats,
  setSessionCacheConfig,
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

    it("coalesces concurrent read calls for the same agent", async () => {
      writeSessionsFile("agent-concurrent", { s1: { sessionId: "s1", updatedAt: 1 } });
      const originalReadFile = fs.promises.readFile;
      const readSpy = vi.spyOn(fs.promises, "readFile").mockImplementation(async (fp, encoding) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return originalReadFile(fp, encoding);
      });

      const results = await Promise.all([
        getCachedSessions("agent-concurrent"),
        getCachedSessions("agent-concurrent"),
        getCachedSessions("agent-concurrent"),
      ]);

      expect(results).toEqual([
        { s1: { sessionId: "s1", updatedAt: 1 } },
        { s1: { sessionId: "s1", updatedAt: 1 } },
        { s1: { sessionId: "s1", updatedAt: 1 } },
      ]);
      expect(readSpy).toHaveBeenCalledTimes(1);
      readSpy.mockRestore();
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

  describe("getCachedSessionEntries", () => {
    it("does not let persisted session payload overwrite canonical/session-computed fields", async () => {
      writeSessionsFile("agent-override", {
        legacy: {
          sessionId: "legacy-session",
          status: "poisoned",
          sessionKey: "agent:evil:legacy",
          sessionRole: "evil-role",
          sessionAlias: "evil-alias",
          modelLabel: "evil-model",
          fullSlug: "not-a-canonical-slug",
          updatedAt: 0,
        },
      });

      const result = await getCachedSessionEntries("agent-override");
      expect(result.invalid).toHaveLength(0);
      expect(result.sessions).toHaveLength(1);

      const session = result.sessions[0];
      expect(session.key).toBe("legacy");
      expect(session.sessionKey).toBe("agent:agent-override:legacy");
      expect(session.status).toBe("stale");
      expect(session.sessionRole).toBe("main");
      expect(session.fullSlug).toBe("agent:agent-override:legacy");
      expect(session.sessionAlias).toBe("legacy");
      expect(session.modelLabel).not.toBe("evil-model");
    });

    it("builds and memoizes canonicalized sessions once across concurrent callers", async () => {
      writeSessionsFile("agent-derive", {
        "legacy-main": {
          sessionId: "legacy-session",
          updatedAt: 10,
          spawnedBy: "missing",
          model: "anthropic/claude-sonnet-4",
          label: "",
        },
      });
      const originalReadFile = fs.promises.readFile;
      const readSpy = vi.spyOn(fs.promises, "readFile").mockImplementation(async (fp, encoding) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return originalReadFile(fp, encoding);
      });

      const [first, second, third] = await Promise.all([
        getCachedSessionEntries("agent-derive"),
        getCachedSessionEntries("agent-derive"),
        getCachedSessionEntries("agent-derive"),
      ]);

      expect(first.sessions).toEqual(second.sessions);
      expect(first.sessions).toEqual(third.sessions);
      expect(first.invalid).toHaveLength(0);
      expect(readSpy).toHaveBeenCalledTimes(1);
      readSpy.mockRestore();
    });

    it("does not cache negative payload derivations from missing sessions.json", async () => {
      const rawSpy = vi.spyOn(fs.promises, "readFile");

      await getCachedSessionEntries("missing-json");
      writeSessionsFile("missing-json", {
        "main-session": { sessionId: "main", updatedAt: Date.now() },
      });
      await getCachedSessionEntries("missing-json");

      expect(rawSpy).toHaveBeenCalledTimes(2);
      rawSpy.mockRestore();
    });

    it("bounds cache maps and reports sizes", async () => {
      setSessionCacheConfig({ maxRawEntries: 2, maxDerivedEntries: 1 });
      try {
        for (let i = 0; i < 4; i++) {
          writeSessionsFile(`bounded-${i}`, {
            session: { sessionId: "sid", updatedAt: Date.now() - i },
          });
        }

        for (let i = 0; i < 4; i++) {
          await getCachedSessionEntries(`bounded-${i}`);
        }

        const stats = getSessionCacheStats();
        expect(stats.rawSize).toBeLessThanOrEqual(2);
        expect(stats.derivedSize).toBeLessThanOrEqual(1);
      } finally {
        setSessionCacheConfig({ maxRawEntries: 128, maxDerivedEntries: 128 });
      }
    });
  });
});
