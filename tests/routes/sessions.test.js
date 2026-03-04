import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const helpers = require("../../lib/helpers");
const sessionCache = require("../../lib/session-cache");

const TMPDIR = path.join(os.tmpdir(), "openclaw-hud-routes-sessions-" + Date.now());
fs.mkdirSync(TMPDIR, { recursive: true });

afterEach(() => {
  fs.rmSync(TMPDIR, { recursive: true, force: true });
});

helpers.OPENCLAW_HOME = TMPDIR;
const originalGetModelAliasMap = helpers.getModelAliasMap;

function writeSessionsFile(agentId, data) {
  const dir = path.join(TMPDIR, "agents", agentId, "sessions");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "sessions.json"), JSON.stringify(data));
}

function clearAgentsDir() {
  const agentsDir = path.join(TMPDIR, "agents");
  fs.rmSync(agentsDir, { recursive: true, force: true });
  fs.mkdirSync(agentsDir, { recursive: true });
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createApp(overrides = {}) {
  const router = createRouter(overrides);
  const app = express();
  app.use(router);
  return app;
}

function createRouter(overrides = {}) {
  delete require.cache[require.resolve("../../routes/sessions")];
  const router = require("../../routes/sessions");
  const deps = {
    safeReaddirAsync: vi.fn(async () => []),
    safeReadAsync: vi.fn(async () => null),
    tailLines: vi.fn(async () => []),
    getCachedSessionEntries: sessionCache.getCachedSessionEntries,
    canonicalizeRelationshipKey: helpers.canonicalizeRelationshipKey,
    ...overrides,
  };
  router.__setDependencies?.(deps);
  return router;
}

function getRouteHandler(router, method, routePath) {
  const layer = router.stack.find(
    (entry) => entry.route && entry.route.path === routePath && entry.route.methods[method],
  );
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[0].handle;
}

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(key, value) {
      this.headers[String(key).toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe("GET /api/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAgentsDir();
    sessionCache.clearSessionCache();
    fs.writeFileSync(path.join(TMPDIR, "openclaw.json"), "{}");
    helpers.getModelAliasMap = originalGetModelAliasMap;
  });

  afterEach(() => {
    if (Date.now.mockRestore) Date.now.mockRestore();
  });

  it("returns empty array when no agents exist", async () => {
    const app = createApp({ safeReaddirAsync: vi.fn(async () => []) });
    const res = await request(app).get("/api/sessions");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns sessions from multiple agents sorted by updatedAt", async () => {
    const now = Date.now();
    writeSessionsFile("a1", { k1: { sessionId: "s1", updatedAt: now - 2000 } });
    writeSessionsFile("a2", { k2: { sessionId: "s2", updatedAt: now - 1000 } });
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["a1", "a2"]) });

    const res = await request(app).get("/api/sessions");
    expect(res.body).toHaveLength(2);
    expect(res.body[0].key).toBe("k2");
    expect(res.body[0].agentId).toBe("a2");
    expect(res.body[0].sessionKey).toBe("agent:a2:k2");
  });

  it("filters out sessions older than 24 hours", async () => {
    const now = Date.now();
    writeSessionsFile("a1", {
      recent: { sessionId: "s1", updatedAt: now - 1000 },
      old: { sessionId: "s2", updatedAt: now - 90000000 },
    });
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["a1"]) });

    const res = await request(app).get("/api/sessions");
    expect(res.body).toHaveLength(1);
    expect(res.body[0].key).toBe("recent");
  });

  it("limits results to 100 sessions", async () => {
    const now = Date.now();
    const sessions = {};
    for (let i = 0; i < 150; i++) sessions[`k${i}`] = { sessionId: `s${i}`, updatedAt: now - i * 1000 };
    writeSessionsFile("a1", sessions);
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["a1"]) });

    const res = await request(app).get("/api/sessions");
    expect(res.body).toHaveLength(100);
  });

  it("includes status from canonical session computation", async () => {
    const now = Date.now();
    writeSessionsFile("a1", {
      k1: { sessionId: "s1", updatedAt: now - 20 * 60 * 1000, spawnDepth: 0 },
    });
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["a1"]) });
    const res = await request(app).get("/api/sessions");
    expect(res.body[0].status).toBe("warm");
  });

  it("canonicalizes main session key as agent:<agentId>:main", async () => {
    const now = Date.now();
    writeSessionsFile("agentA", { main: { sessionId: "internal-main-session", updatedAt: now } });
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["agentA"]) });
    const res = await request(app).get("/api/sessions");
    expect(res.status).toBe(200);
    expect(res.body[0].sessionKey).toBe("agent:agentA:main");
  });

  it("skips invalid stored session keys and exposes warning headers", async () => {
    const now = Date.now();
    writeSessionsFile("a1", {
      validKey: { sessionId: "s-ok", updatedAt: now },
      "bad key": { sessionId: "s1", updatedAt: now },
    });
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["a1"]) });
    const res = await request(app).get("/api/sessions");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].key).toBe("validKey");
    expect(res.headers["x-openclaw-warning-code"]).toBe("INVALID_SESSION_KEYS");
    expect(res.headers["x-openclaw-warning-count"]).toBe("1");
    expect(res.headers["x-openclaw-warning-route"]).toBe("/api/sessions");
  });

  it("enriches sessions with display metadata and preserves slug fields", async () => {
    helpers.getModelAliasMap = vi.fn(() => ({
      "anthropic/claude-sonnet-4": { alias: "sonnet" },
      "openai/gpt-4o": { alias: "gpt4o" },
    }));
    const now = Date.now();
    writeSessionsFile("agent-a", {
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
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["agent-a"]) });

    const res = await request(app).get("/api/sessions");
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
  });

  it("shares one session read across concurrent /api/sessions and /api/session-tree calls", async () => {
    const now = Date.now();
    writeSessionsFile("a1", {
      root: { sessionId: "s1", updatedAt: now, model: "anthropic/claude-sonnet-4" },
    });
    const readSpy = vi.spyOn(fs.promises, "readFile");

    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["a1"]) });
    await Promise.all([request(app).get("/api/sessions"), request(app).get("/api/session-tree")]);

    const sessionsReads = readSpy.mock.calls.filter(([file]) => String(file).includes("sessions.json"));
    expect(sessionsReads).toHaveLength(1);
    readSpy.mockRestore();
  });

  it("starts per-agent reads in parallel for /api/sessions", async () => {
    const now = Date.now();
    const deferredByAgent = {
      a1: createDeferred(),
      a2: createDeferred(),
      a3: createDeferred(),
    };
    const getCachedSessionEntries = vi.fn((agentId) => deferredByAgent[agentId].promise);
    const router = createRouter({
      safeReaddirAsync: vi.fn(async () => ["a1", "a2", "a3"]),
      getCachedSessionEntries,
    });
    const handler = getRouteHandler(router, "get", "/api/sessions");
    const req = {};
    const res = createMockRes();

    const pending = handler(req, res);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getCachedSessionEntries).toHaveBeenCalledTimes(3);

    deferredByAgent.a1.resolve({ sessions: [{ key: "a1-main", updatedAt: now }], invalid: [] });
    deferredByAgent.a2.resolve({ sessions: [{ key: "a2-main", updatedAt: now - 1 }], invalid: [] });
    deferredByAgent.a3.resolve({ sessions: [{ key: "a3-main", updatedAt: now - 2 }], invalid: [] });

    await pending;
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveLength(3);
  });

  it("computes current time once per /api/sessions request for recency filtering", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const getCachedSessionEntries = vi.fn(async (agentId) => ({
      sessions: [
        { key: `${agentId}-recent`, updatedAt: 99_999, sessionKey: `agent:${agentId}:recent` },
        { key: `${agentId}-old`, updatedAt: 1, sessionKey: `agent:${agentId}:old` },
      ],
      invalid: [],
    }));
    const router = createRouter({
      safeReaddirAsync: vi.fn(async () => ["a1", "a2"]),
      getCachedSessionEntries,
    });
    const handler = getRouteHandler(router, "get", "/api/sessions");
    const req = {};
    const res = createMockRes();

    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(nowSpy).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/session-log/:agentId/:sessionId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAgentsDir();
    sessionCache.clearSessionCache();
    fs.writeFileSync(path.join(TMPDIR, "openclaw.json"), "{}");
  });

  it("rejects invalid agentId with path traversal", async () => {
    const app = createApp({ safeReadAsync: vi.fn(async () => null) });
    const res = await request(app).get("/api/session-log/agent%20bad/sess1");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid parameters");
  });

  it("rejects sessionId with special characters", async () => {
    const app = createApp({ safeReadAsync: vi.fn(async () => null) });
    const res = await request(app).get("/api/session-log/agent1/sess%20bad");
    expect(res.status).toBe(400);
  });

  it("returns empty array when log file does not exist", async () => {
    const app = createApp({
      tailLines: vi.fn(async () => []),
      safeReaddirAsync: vi.fn(async () => ["agent1"]),
    });
    const res = await request(app).get("/api/session-log/agent1/sess1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns parsed JSONL entries limited to last N lines", async () => {
    const lines = Array.from({ length: 100 }, (_, i) => JSON.stringify({ type: "msg", idx: i }));
    const app = createApp({
      tailLines: vi.fn(async () => lines.slice(-10)),
      safeReaddirAsync: vi.fn(async () => []),
    });
    const res = await request(app).get("/api/session-log/agent1/sess1?limit=10");
    expect(res.body).toHaveLength(10);
    expect(res.body[0].idx).toBe(90);
  });

  it("defaults to 50 entries when no limit specified", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => JSON.stringify({ type: "msg", idx: i }));
    const tailLines = vi.fn(async () => lines);
    const app = createApp({
      tailLines,
      safeReaddirAsync: vi.fn(async () => []),
    });
    const res = await request(app).get("/api/session-log/agent1/sess1");
    expect(res.body).toHaveLength(50);
    expect(tailLines).toHaveBeenCalledWith(expect.any(String), 50);
  });

  it("skips malformed JSON lines gracefully", async () => {
    const app = createApp({
      tailLines: vi.fn(async () => ['{"valid":true}', "not-json", '{"also":"valid"}']),
      safeReaddirAsync: vi.fn(async () => []),
    });
    const res = await request(app).get("/api/session-log/agent1/sess1");
    expect(res.body).toHaveLength(2);
  });

  it("uses tail reader for positive limits and avoids full log reads", async () => {
    const tailLines = vi.fn(async () => ['{"idx":98}', '{"idx":99}']);
    const safeReadAsync = vi.fn(async () => '{"idx":0}');
    const app = createApp({
      tailLines,
      safeReadAsync,
      safeReaddirAsync: vi.fn(async () => []),
    });

    const res = await request(app).get("/api/session-log/agent1/sess1?limit=2");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ idx: 98 }, { idx: 99 }]);
    expect(tailLines).toHaveBeenCalledTimes(1);
    expect(safeReadAsync).not.toHaveBeenCalled();
  });
});

describe("GET /api/session-tree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAgentsDir();
    sessionCache.clearSessionCache();
    fs.writeFileSync(path.join(TMPDIR, "openclaw.json"), "{}");
  });

  afterEach(() => {
    if (Date.now.mockRestore) Date.now.mockRestore();
  });

  it("returns sessions with child counts computed from spawnedBy links", async () => {
    const now = Date.now();
    writeSessionsFile("a1", {
      parent: { sessionId: "p", updatedAt: now, spawnDepth: 0 },
      child1: { sessionId: "c1", updatedAt: now, spawnedBy: "parent", spawnDepth: 1 },
      child2: { sessionId: "c2", updatedAt: now, spawnedBy: "parent", spawnDepth: 1 },
    });
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["a1"]) });

    const res = await request(app).get("/api/session-tree");
    const parent = res.body.find((s) => s.key === "parent");
    expect(parent.childCount).toBe(2);
    const child = res.body.find((s) => s.key === "child1");
    expect(child.spawnedBy).toBe("parent");
    expect(child.childCount).toBe(0);
  });

  it("resolves mixed legacy/canonical spawnedBy values to the parent key present in payload", async () => {
    const now = Date.now();
    writeSessionsFile("a1", {
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
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["a1"]) });

    const res = await request(app).get("/api/session-tree");
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
    writeSessionsFile("a1", {
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
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["a1"]) });

    const res = await request(app).get("/api/session-tree");
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
    writeSessionsFile("a1", {
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
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["a1"]) });

    const res = await request(app).get("/api/session-tree");
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
    writeSessionsFile("a1", {
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
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["a1"]) });

    const res = await request(app).get("/api/session-tree");
    const keys = new Set(res.body.map((s) => s.key));
    for (const session of res.body) {
      if (session.spawnedBy !== null) {
        expect(keys.has(session.spawnedBy)).toBe(true);
      }
    }
  });

  it("uses computed canonicalSpawnedBy even when payload contains a persisted canonicalSpawnedBy field", async () => {
    const now = Date.now();
    writeSessionsFile("a1", {
      "legacy-parent": { sessionId: "p", updatedAt: now, spawnDepth: 0 },
      child: {
        sessionId: "c1",
        updatedAt: now,
        spawnedBy: "legacy-parent",
        canonicalSpawnedBy: "agent:a1:missing-parent",
        spawnDepth: 1,
      },
    });
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["a1"]) });

    const res = await request(app).get("/api/session-tree");
    const parent = res.body.find((s) => s.key === "legacy-parent");
    const child = res.body.find((s) => s.key === "child");

    expect(parent.childCount).toBe(1);
    expect(child.spawnedBy).toBe("legacy-parent");
  });

  it("nullifies spawnedBy when parent session does not exist", async () => {
    const now = Date.now();
    writeSessionsFile("a1", {
      orphan: { sessionId: "o", updatedAt: now, spawnedBy: "nonexistent", spawnDepth: 1 },
    });
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["a1"]) });
    const res = await request(app).get("/api/session-tree");
    expect(res.body[0].spawnedBy).toBeNull();
  });

  it("filters sessions older than 24 hours", async () => {
    const now = Date.now();
    writeSessionsFile("a1", {
      recent: { sessionId: "r", updatedAt: now },
      old: { sessionId: "o", updatedAt: now - 90000000 },
    });
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["a1"]) });
    const res = await request(app).get("/api/session-tree");
    expect(res.body).toHaveLength(1);
    expect(res.body[0].key).toBe("recent");
  });

  it("includes canonical sessionKey for tree nodes", async () => {
    const now = Date.now();
    writeSessionsFile("a1", { main: { sessionId: "internal-main-id", updatedAt: now } });
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["a1"]) });
    const res = await request(app).get("/api/session-tree");
    expect(res.status).toBe(200);
    expect(res.body[0].sessionKey).toBe("agent:a1:main");
  });

  it("skips invalid tree session keys and exposes warning headers", async () => {
    const now = Date.now();
    writeSessionsFile("a1", {
      main: { sessionId: "ok", updatedAt: now },
      "bad key": { sessionId: "x", updatedAt: now },
    });
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["a1"]) });
    const res = await request(app).get("/api/session-tree");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].key).toBe("main");
    expect(res.headers["x-openclaw-warning-code"]).toBe("INVALID_SESSION_KEYS");
    expect(res.headers["x-openclaw-warning-count"]).toBe("1");
    expect(res.headers["x-openclaw-warning-route"]).toBe("/api/session-tree");
  });

  it("enriches tree entries with display metadata fields", async () => {
    helpers.getModelAliasMap = vi.fn(() => ({
      "anthropic/claude-sonnet-4": { alias: "sonnet" },
      "openai/gpt-4o": { alias: "gpt4o" },
    }));
    const now = Date.now();
    writeSessionsFile("agent-a", {
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
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["agent-a"]) });
    const res = await request(app).get("/api/session-tree");
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
  });

  it("starts per-agent reads in parallel for /api/session-tree", async () => {
    const now = Date.now();
    const deferredByAgent = {
      a1: createDeferred(),
      a2: createDeferred(),
      a3: createDeferred(),
    };
    const getCachedSessionEntries = vi.fn((agentId) => deferredByAgent[agentId].promise);
    const router = createRouter({
      safeReaddirAsync: vi.fn(async () => ["a1", "a2", "a3"]),
      getCachedSessionEntries,
    });
    const handler = getRouteHandler(router, "get", "/api/session-tree");
    const req = {};
    const res = createMockRes();

    const pending = handler(req, res);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getCachedSessionEntries).toHaveBeenCalledTimes(3);

    deferredByAgent.a1.resolve({ sessions: [{ key: "a1-root", sessionKey: "agent:a1:root", updatedAt: now }], invalid: [] });
    deferredByAgent.a2.resolve({ sessions: [{ key: "a2-root", sessionKey: "agent:a2:root", updatedAt: now - 1 }], invalid: [] });
    deferredByAgent.a3.resolve({ sessions: [{ key: "a3-root", sessionKey: "agent:a3:root", updatedAt: now - 2 }], invalid: [] });

    await pending;
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveLength(3);
  });

  it("computes current time once per /api/session-tree request for recency filtering", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const getCachedSessionEntries = vi.fn(async (agentId) => ({
      sessions: [
        { key: `${agentId}-recent`, sessionKey: `agent:${agentId}:recent`, updatedAt: 99_999 },
        { key: `${agentId}-old`, sessionKey: `agent:${agentId}:old`, updatedAt: 1 },
      ],
      invalid: [],
    }));
    const router = createRouter({
      safeReaddirAsync: vi.fn(async () => ["a1", "a2"]),
      getCachedSessionEntries,
    });
    const handler = getRouteHandler(router, "get", "/api/session-tree");
    const req = {};
    const res = createMockRes();

    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(nowSpy).toHaveBeenCalledTimes(1);
  });

  it("returns 304 when If-None-Match matches session-tree ETag", async () => {
    const now = Date.now();
    writeSessionsFile("a1", {
      main: { sessionId: "p", updatedAt: now, spawnDepth: 0 },
      child: { sessionId: "c", updatedAt: now, spawnedBy: "main", spawnDepth: 1 },
    });
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["a1"]) });
    const first = await request(app).get("/api/session-tree");
    const etag = first.headers.etag;

    const second = await request(app).get("/api/session-tree").set("If-None-Match", etag);

    expect(second.status).toBe(304);
    expect(second.body).toEqual({});
  });
});
