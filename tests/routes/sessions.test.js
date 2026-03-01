import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const helpers = require("../../lib/helpers");
const sessionCache = require("../../lib/session-cache");

helpers.OPENCLAW_HOME = "/mock/home";
helpers.safeReaddirAsync = vi.fn(async () => []);
helpers.safeReadAsync = vi.fn(async () => null);
sessionCache.getCachedSessions = vi.fn(async () => null);
helpers.getSessionStatus = vi.fn(() => "active");

function createApp() {
  delete require.cache[require.resolve("../../routes/sessions")];
  const router = require("../../routes/sessions");
  const app = express();
  app.use(router);
  return app;
}

describe("GET /api/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    helpers.getSessionStatus.mockReturnValue("active");
    helpers.safeReaddirAsync = vi.fn(async () => []);
    sessionCache.getCachedSessions = vi.fn(async () => null);
  });

  it("returns empty array when no agents exist", async () => {
    helpers.safeReaddirAsync.mockResolvedValue([]);
    const res = await request(createApp()).get("/api/sessions");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns sessions from multiple agents sorted by updatedAt", async () => {
    const now = Date.now();
    helpers.safeReaddirAsync.mockResolvedValue(["a1", "a2"]);
    sessionCache.getCachedSessions.mockImplementation(async (agentId) => {
      if (agentId === "a1") return { k1: { sessionId: "s1", updatedAt: now - 2000 } };
      if (agentId === "a2") return { k2: { sessionId: "s2", updatedAt: now - 1000 } };
      return null;
    });
    const res = await request(createApp()).get("/api/sessions");
    expect(res.body).toHaveLength(2);
    expect(res.body[0].key).toBe("k2");
    expect(res.body[0].agentId).toBe("a2");
    expect(res.body[0].sessionKey).toBe("agent:a2:k2");
  });

  it("filters out sessions older than 24 hours", async () => {
    const now = Date.now();
    helpers.safeReaddirAsync.mockResolvedValue(["a1"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      recent: { sessionId: "s1", updatedAt: now - 1000 },
      old: { sessionId: "s2", updatedAt: now - 90000000 },
    });
    const res = await request(createApp()).get("/api/sessions");
    expect(res.body).toHaveLength(1);
    expect(res.body[0].key).toBe("recent");
  });

  it("limits results to 100 sessions", async () => {
    const now = Date.now();
    helpers.safeReaddirAsync.mockResolvedValue(["a1"]);
    const sessions = {};
    for (let i = 0; i < 150; i++)
      sessions[`k${i}`] = { sessionId: `s${i}`, updatedAt: now - i * 1000 };
    sessionCache.getCachedSessions.mockResolvedValue(sessions);
    const res = await request(createApp()).get("/api/sessions");
    expect(res.body).toHaveLength(100);
  });

  it("includes status from getSessionStatus", async () => {
    const now = Date.now();
    helpers.safeReaddirAsync.mockResolvedValue(["a1"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      k1: { sessionId: "s1", updatedAt: now },
    });
    helpers.getSessionStatus.mockReturnValue("warm");
    const res = await request(createApp()).get("/api/sessions");
    expect(res.body[0].status).toBe("warm");
  });

  it("canonicalizes main session key as agent:<agentId>:main", async () => {
    const now = Date.now();
    helpers.safeReaddirAsync.mockResolvedValue(["agentA"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      main: { sessionId: "internal-main-session", updatedAt: now },
    });
    const res = await request(createApp()).get("/api/sessions");
    expect(res.status).toBe(200);
    expect(res.body[0].sessionKey).toBe("agent:agentA:main");
  });

  it("skips invalid stored session keys and exposes warning headers", async () => {
    const now = Date.now();
    helpers.safeReaddirAsync.mockResolvedValue(["a1"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      validKey: { sessionId: "s-ok", updatedAt: now },
      "bad key": { sessionId: "s1", updatedAt: now },
    });
    const res = await request(createApp()).get("/api/sessions");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].key).toBe("validKey");
    expect(res.headers["x-openclaw-warning-code"]).toBe("INVALID_SESSION_KEYS");
    expect(res.headers["x-openclaw-warning-count"]).toBe("1");
    expect(res.headers["x-openclaw-warning-route"]).toBe("/api/sessions");
  });

  it("enriches sessions with display metadata and preserves slug fields", async () => {
    const now = Date.now();
    helpers.getModelAliasMap = vi.fn(() => ({
      "anthropic/claude-sonnet-4": { alias: "sonnet" },
      "openai/gpt-4o": { alias: "gpt4o" },
    }));
    helpers.safeReaddirAsync.mockResolvedValue(["agent-a"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      main: {
        sessionId: "main-session",
        updatedAt: now,
        model: "anthropic/claude-sonnet-4",
      },
      "sub-task": {
        sessionId: "sub-session",
        updatedAt: now,
        label: "",
        spawnedBy: "main",
        spawnDepth: 1,
        model: "openai/gpt-4o",
      },
    });

    const res = await request(createApp()).get("/api/sessions");
    const main = res.body.find((s) => s.key === "main");
    const sub = res.body.find((s) => s.key === "sub-task");

    expect(main.sessionRole).toBe("main");
    expect(main.sessionAlias).toBe("main");
    expect(main.modelLabel).toBe("sonnet");
    expect(main.fullSlug).toBe("agent:agent-a:main");
    expect(main.sessionKey).toBe(main.fullSlug);

    expect(sub.sessionRole).toBe("subagent");
    expect(sub.sessionAlias).toBe("sub-task");
    expect(sub.modelLabel).toBe("gpt4o");
    expect(sub.fullSlug).toBe("agent:agent-a:sub-task");
    expect(sub.sessionKey).toBe(sub.fullSlug);
    expect(helpers.getModelAliasMap).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/session-log/:agentId/:sessionId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    helpers.safeReadAsync = vi.fn(async () => null);
  });

  it("rejects invalid agentId with path traversal", async () => {
    const res = await request(createApp()).get("/api/session-log/agent%20bad/sess1");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid parameters");
  });

  it("rejects sessionId with special characters", async () => {
    const res = await request(createApp()).get("/api/session-log/agent1/sess%20bad");
    expect(res.status).toBe(400);
  });

  it("returns empty array when log file does not exist", async () => {
    helpers.safeReadAsync.mockResolvedValue(null);
    const res = await request(createApp()).get("/api/session-log/agent1/sess1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns parsed JSONL entries limited to last N lines", async () => {
    const lines = Array.from({ length: 100 }, (_, i) => JSON.stringify({ type: "msg", idx: i }));
    helpers.safeReadAsync.mockResolvedValue(lines.join("\n"));
    const res = await request(createApp()).get("/api/session-log/agent1/sess1?limit=10");
    expect(res.body).toHaveLength(10);
    expect(res.body[0].idx).toBe(90);
  });

  it("defaults to 50 entries when no limit specified", async () => {
    const lines = Array.from({ length: 80 }, (_, i) => JSON.stringify({ type: "msg", idx: i }));
    helpers.safeReadAsync.mockResolvedValue(lines.join("\n"));
    const res = await request(createApp()).get("/api/session-log/agent1/sess1");
    expect(res.body).toHaveLength(50);
  });

  it("skips malformed JSON lines gracefully", async () => {
    helpers.safeReadAsync.mockResolvedValue('{"valid":true}\nnot-json\n{"also":"valid"}');
    const res = await request(createApp()).get("/api/session-log/agent1/sess1");
    expect(res.body).toHaveLength(2);
  });
});

describe("GET /api/session-tree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    helpers.getSessionStatus.mockReturnValue("active");
    helpers.safeReaddirAsync = vi.fn(async () => []);
    sessionCache.getCachedSessions = vi.fn(async () => null);
  });

  it("returns sessions with child counts computed from spawnedBy links", async () => {
    const now = Date.now();
    helpers.safeReaddirAsync.mockResolvedValue(["a1"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      parent: { sessionId: "p", updatedAt: now, spawnDepth: 0 },
      child1: { sessionId: "c1", updatedAt: now, spawnedBy: "parent", spawnDepth: 1 },
      child2: { sessionId: "c2", updatedAt: now, spawnedBy: "parent", spawnDepth: 1 },
    });
    const res = await request(createApp()).get("/api/session-tree");
    const parent = res.body.find((s) => s.key === "parent");
    expect(parent.childCount).toBe(2);
    const child = res.body.find((s) => s.key === "child1");
    expect(child.spawnedBy).toBe("parent");
    expect(child.childCount).toBe(0);
  });

  it("resolves mixed legacy/canonical spawnedBy values to the parent key present in payload", async () => {
    const now = Date.now();
    helpers.safeReaddirAsync.mockResolvedValue(["a1"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      main: { sessionId: "p", updatedAt: now, spawnDepth: 0 },
      "child-legacy-key": {
        sessionId: "c1",
        updatedAt: now,
        spawnedBy: "agent:a1:main",
        spawnDepth: 1,
      },
      "agent:a1:child-canonical-key": {
        sessionId: "c2",
        updatedAt: now,
        spawnedBy: "main",
        spawnDepth: 1,
      },
    });

    const res = await request(createApp()).get("/api/session-tree");
    const parent = res.body.find((s) => s.key === "main");
    const childWithCanonicalSpawnedBy = res.body.find((s) => s.key === "child-legacy-key");
    const childWithLegacySpawnedBy = res.body.find((s) => s.key === "agent:a1:child-canonical-key");

    expect(parent.childCount).toBe(2);
    expect(childWithCanonicalSpawnedBy.spawnedBy).toBe("main");
    expect(childWithLegacySpawnedBy.spawnedBy).toBe("main");
    expect(childWithCanonicalSpawnedBy.childCount).toBe(0);
    expect(childWithLegacySpawnedBy.childCount).toBe(0);
  });

  it("deterministically prefers canonical entries when legacy and canonical keys collide", async () => {
    const now = Date.now();
    helpers.safeReaddirAsync.mockResolvedValue(["a1"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      main: { sessionId: "legacy-main", label: "legacy", updatedAt: now, spawnDepth: 0 },
      "agent:a1:main": {
        sessionId: "canonical-main",
        label: "canonical",
        updatedAt: now,
        spawnDepth: 0,
      },
      "child-legacy-link": { sessionId: "c1", updatedAt: now, spawnedBy: "main", spawnDepth: 1 },
      "child-canonical-link": {
        sessionId: "c2",
        updatedAt: now,
        spawnedBy: "agent:a1:main",
        spawnDepth: 1,
      },
    });

    const res = await request(createApp()).get("/api/session-tree");
    const parentMatches = res.body.filter((s) => s.sessionKey === "agent:a1:main");
    const childLegacyLink = res.body.find((s) => s.key === "child-legacy-link");
    const childCanonicalLink = res.body.find((s) => s.key === "child-canonical-link");

    expect(parentMatches).toHaveLength(1);
    expect(parentMatches[0].key).toBe("agent:a1:main");
    expect(parentMatches[0].sessionId).toBe("canonical-main");
    expect(parentMatches[0].childCount).toBe(2);
    expect(res.body.some((s) => s.key === "main")).toBe(false);
    expect(childLegacyLink.spawnedBy).toBe("agent:a1:main");
    expect(childCanonicalLink.spawnedBy).toBe("agent:a1:main");
  });

  it("keeps canonical parent deterministic when canonical key appears before legacy alias", async () => {
    const now = Date.now();
    helpers.safeReaddirAsync.mockResolvedValue(["a1"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      "agent:a1:main": {
        sessionId: "canonical-main",
        label: "canonical-first",
        updatedAt: now,
        spawnDepth: 0,
      },
      main: {
        sessionId: "legacy-main",
        label: "legacy-second",
        updatedAt: now,
        spawnDepth: 0,
      },
      "child-from-legacy-link": {
        sessionId: "c1",
        updatedAt: now,
        spawnedBy: "main",
        spawnDepth: 1,
      },
      "child-from-canonical-link": {
        sessionId: "c2",
        updatedAt: now,
        spawnedBy: "agent:a1:main",
        spawnDepth: 1,
      },
    });

    const res = await request(createApp()).get("/api/session-tree");
    const parentMatches = res.body.filter((s) => s.sessionKey === "agent:a1:main");
    const childLegacyLink = res.body.find((s) => s.key === "child-from-legacy-link");
    const childCanonicalLink = res.body.find((s) => s.key === "child-from-canonical-link");

    expect(parentMatches).toHaveLength(1);
    expect(parentMatches[0].key).toBe("agent:a1:main");
    expect(parentMatches[0].sessionId).toBe("canonical-main");
    expect(parentMatches[0].childCount).toBe(2);
    expect(res.body.some((s) => s.key === "main")).toBe(false);
    expect(childLegacyLink.spawnedBy).toBe("agent:a1:main");
    expect(childCanonicalLink.spawnedBy).toBe("agent:a1:main");
  });

  it("ensures every non-null spawnedBy matches an existing parent key in the same payload", async () => {
    const now = Date.now();
    helpers.safeReaddirAsync.mockResolvedValue(["a1"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      main: { sessionId: "p", updatedAt: now, spawnDepth: 0 },
      "agent:a1:canonical-parent": { sessionId: "cp", updatedAt: now, spawnDepth: 0 },
      "child-from-canonical-input": {
        sessionId: "c1",
        updatedAt: now,
        spawnedBy: "agent:a1:main",
        spawnDepth: 1,
      },
      "child-from-legacy-input": {
        sessionId: "c2",
        updatedAt: now,
        spawnedBy: "canonical-parent",
        spawnDepth: 1,
      },
      orphan: { sessionId: "o", updatedAt: now, spawnedBy: "missing-parent", spawnDepth: 1 },
    });

    const res = await request(createApp()).get("/api/session-tree");
    const keys = new Set(res.body.map((s) => s.key));
    for (const session of res.body) {
      if (session.spawnedBy !== null) {
        expect(keys.has(session.spawnedBy)).toBe(true);
      }
    }
  });

  it("uses computed canonicalSpawnedBy even when payload contains a persisted canonicalSpawnedBy field", async () => {
    const now = Date.now();
    helpers.safeReaddirAsync.mockResolvedValue(["a1"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      "legacy-parent": { sessionId: "p", updatedAt: now, spawnDepth: 0 },
      child: {
        sessionId: "c1",
        updatedAt: now,
        spawnedBy: "legacy-parent",
        canonicalSpawnedBy: "agent:a1:missing-parent",
        spawnDepth: 1,
      },
    });

    const res = await request(createApp()).get("/api/session-tree");
    const parent = res.body.find((s) => s.key === "legacy-parent");
    const child = res.body.find((s) => s.key === "child");

    expect(parent.childCount).toBe(1);
    expect(child.spawnedBy).toBe("legacy-parent");
  });

  it("nullifies spawnedBy when parent session does not exist", async () => {
    const now = Date.now();
    helpers.safeReaddirAsync.mockResolvedValue(["a1"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      orphan: { sessionId: "o", updatedAt: now, spawnedBy: "nonexistent", spawnDepth: 1 },
    });
    const res = await request(createApp()).get("/api/session-tree");
    expect(res.body[0].spawnedBy).toBeNull();
  });

  it("filters sessions older than 24 hours", async () => {
    const now = Date.now();
    helpers.safeReaddirAsync.mockResolvedValue(["a1"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      recent: { sessionId: "r", updatedAt: now },
      old: { sessionId: "o", updatedAt: now - 90000000 },
    });
    const res = await request(createApp()).get("/api/session-tree");
    expect(res.body).toHaveLength(1);
    expect(res.body[0].key).toBe("recent");
  });

  it("includes canonical sessionKey for tree nodes", async () => {
    const now = Date.now();
    helpers.safeReaddirAsync.mockResolvedValue(["a1"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      main: { sessionId: "internal-main-id", updatedAt: now },
    });
    const res = await request(createApp()).get("/api/session-tree");
    expect(res.status).toBe(200);
    expect(res.body[0].sessionKey).toBe("agent:a1:main");
  });

  it("skips invalid tree session keys and exposes warning headers", async () => {
    const now = Date.now();
    helpers.safeReaddirAsync.mockResolvedValue(["a1"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      main: { sessionId: "ok", updatedAt: now },
      "bad key": { sessionId: "x", updatedAt: now },
    });
    const res = await request(createApp()).get("/api/session-tree");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].key).toBe("main");
    expect(res.headers["x-openclaw-warning-code"]).toBe("INVALID_SESSION_KEYS");
    expect(res.headers["x-openclaw-warning-count"]).toBe("1");
    expect(res.headers["x-openclaw-warning-route"]).toBe("/api/session-tree");
  });

  it("enriches tree entries with display metadata fields", async () => {
    const now = Date.now();
    helpers.getModelAliasMap = vi.fn(() => ({
      "anthropic/claude-sonnet-4": { alias: "sonnet" },
      "openai/gpt-4o": { alias: "gpt4o" },
    }));
    helpers.safeReaddirAsync.mockResolvedValue(["agent-a"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      main: {
        sessionId: "main-session",
        updatedAt: now,
        model: "anthropic/claude-sonnet-4",
      },
      "sub-task": {
        sessionId: "sub-session",
        updatedAt: now,
        label: "",
        spawnedBy: "main",
        spawnDepth: 1,
        model: "openai/gpt-4o",
      },
    });

    const res = await request(createApp()).get("/api/session-tree");
    const main = res.body.find((s) => s.key === "main");
    const sub = res.body.find((s) => s.key === "sub-task");

    expect(main.sessionRole).toBe("main");
    expect(main.sessionAlias).toBe("main");
    expect(main.modelLabel).toBe("sonnet");
    expect(main.fullSlug).toBe("agent:agent-a:main");

    expect(sub.sessionRole).toBe("subagent");
    expect(sub.sessionAlias).toBe("sub-task");
    expect(sub.modelLabel).toBe("gpt4o");
    expect(sub.fullSlug).toBe("agent:agent-a:sub-task");
    expect(helpers.getModelAliasMap).toHaveBeenCalledTimes(1);
  });
});
