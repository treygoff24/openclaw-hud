import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const helpers = require("../../lib/helpers");
const sessionCache = require("../../lib/session-cache");

const TMPDIR = path.join(os.tmpdir(), "openclaw-hud-routes-agents-" + Date.now());
fs.mkdirSync(TMPDIR, { recursive: true });

afterEach(() => {
  fs.rmSync(TMPDIR, { recursive: true, force: true });
});

helpers.OPENCLAW_HOME = TMPDIR;
const originalGetModelAliasMap = helpers.getModelAliasMap;
vi.spyOn(fs.promises, "stat");

function writeConfig(models) {
  const file = path.join(TMPDIR, "openclaw.json");
  fs.mkdirSync(TMPDIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ agents: { defaults: { models } } }));
}

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
  delete require.cache[require.resolve("../../routes/agents")];
  const router = require("../../routes/agents");
  const deps = {
    safeReaddirAsync: vi.fn(async () => []),
    getCachedSessionEntries: sessionCache.getCachedSessionEntries,
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

describe("GET /api/agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAgentsDir();
    sessionCache.clearSessionCache();
    fs.promises.stat.mockResolvedValue({ isDirectory: () => true });
    fs.writeFileSync(path.join(TMPDIR, "openclaw.json"), "{}");
    helpers.getModelAliasMap = originalGetModelAliasMap;
  });

  afterEach(() => {
    if (Date.now.mockRestore) Date.now.mockRestore();
  });

  it("returns empty array when no agents exist", async () => {
    const app = createApp({ safeReaddirAsync: vi.fn(async () => []) });
    const res = await request(app).get("/api/agents");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns agents with session metadata sorted by most recent", async () => {
    const now = Date.now();
    writeSessionsFile("bot-a", {
      "sess-1": { sessionId: "s1", updatedAt: now - 1000, label: "test", spawnDepth: 0 },
    });
    writeSessionsFile("bot-b", {
      "sess-2": { sessionId: "s2", updatedAt: now - 500, label: "newer" },
    });
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["bot-a", "bot-b"]) });

    const res = await request(app).get("/api/agents");
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe("bot-b");
    expect(res.body[1].id).toBe("bot-a");
    expect(res.body[0].sessionCount).toBe(1);
  });

  it("counts active sessions correctly (within 1 hour)", async () => {
    const now = Date.now();
    writeSessionsFile("agent1", {
      s1: { sessionId: "s1", updatedAt: now - 1000 },
      s2: { sessionId: "s2", updatedAt: now - 7200000 },
    });
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["agent1"]) });
    const res = await request(app).get("/api/agents");
    expect(res.body[0].activeSessions).toBe(1);
    expect(res.body[0].sessionCount).toBe(2);
  });

  it("filters out non-directory entries", async () => {
    writeSessionsFile("agent1", { s1: { sessionId: "s1", updatedAt: Date.now() } });
    fs.promises.stat.mockImplementation(async (fp) => ({
      isDirectory: () => !fp.includes("file.txt"),
    }));

    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["agent1", "file.txt"]) });
    const res = await request(app).get("/api/agents");
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("agent1");
  });

  it("handles missing sessions.json gracefully", async () => {
    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["agent1"]) });
    const res = await request(app).get("/api/agents");
    expect(res.body[0].sessions).toEqual([]);
    expect(res.body[0].sessionCount).toBe(0);
  });

  it("enriches agent sessions with role, alias, model, and fullSlug metadata", async () => {
    helpers.getModelAliasMap = vi.fn(() => ({
      "anthropic/claude-sonnet-4": { alias: "sonnet" },
      "openai/gpt-4o": { alias: "gpt4o" },
    }));
    const now = Date.now();
    writeSessionsFile("agent-a", {
      main: {
        sessionId: "main-session",
        updatedAt: now - 1000,
        model: "anthropic/claude-sonnet-4",
      },
      "sub-task": {
        sessionId: "sub-session",
        updatedAt: now,
        spawnedBy: "main",
        spawnDepth: 1,
        model: "openai/gpt-4o",
        label: "",
      },
    });

    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["agent-a"]) });
    const res = await request(app).get("/api/agents");
    const sessions = res.body[0].sessions;
    const sub = sessions.find((s) => s.key === "sub-task");
    const main = sessions.find((s) => s.key === "main");

    expect(sub.sessionRole).toBe("subagent");
    expect(sub.sessionAlias).toBe("sub-task");
    expect(sub.modelLabel).toBe("gpt4o");
    expect(sub.fullSlug).toBe("agent:agent-a:sub-task");
    expect(sub.key).toBe("sub-task");

    expect(main.sessionRole).toBe("main");
    expect(main.sessionAlias).toBe("main");
    expect(main.modelLabel).toBe("sonnet");
    expect(main.fullSlug).toBe("agent:agent-a:main");
    expect(main.sessionKey).toBe(main.fullSlug);
  });

  it("coalesces concurrent /api/agents requests to one sessions.json read", async () => {
    const now = Date.now();
    writeSessionsFile("agent-a", {
      main: { sessionId: "s1", updatedAt: now, model: "anthropic/claude-sonnet-4" },
    });
    const readSpy = vi.spyOn(fs.promises, "readFile");

    const app = createApp({ safeReaddirAsync: vi.fn(async () => ["agent-a"]) });
    await Promise.all([
      request(app).get("/api/agents"),
      request(app).get("/api/agents"),
      request(app).get("/api/agents"),
    ]);

    const sessionReads = readSpy.mock.calls.filter(([file]) =>
      String(file).includes("sessions.json"),
    );
    expect(sessionReads).toHaveLength(1);
    readSpy.mockRestore();
  });

  it("starts per-agent session lookups in parallel", async () => {
    const deferredByAgent = {
      "agent-a": createDeferred(),
      "agent-b": createDeferred(),
      "agent-c": createDeferred(),
    };
    const getCachedSessionEntries = vi.fn((agentId) => deferredByAgent[agentId].promise);
    const router = createRouter({
      safeReaddirAsync: vi.fn(async () => ["agent-a", "agent-b", "agent-c"]),
      getCachedSessionEntries,
    });
    const handler = getRouteHandler(router, "get", "/api/agents");
    const req = {};
    const res = createMockRes();

    const pending = handler(req, res);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getCachedSessionEntries).toHaveBeenCalledTimes(3);

    deferredByAgent["agent-a"].resolve({ sessions: [{ updatedAt: 3 }], invalid: [] });
    deferredByAgent["agent-b"].resolve({ sessions: [{ updatedAt: 2 }], invalid: [] });
    deferredByAgent["agent-c"].resolve({ sessions: [{ updatedAt: 1 }], invalid: [] });

    await pending;
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveLength(3);
  });

  it("computes current time once per /api/agents request when counting active sessions", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const getCachedSessionEntries = vi.fn(async (agentId) => ({
      sessions: [
        { sessionId: `${agentId}-active`, updatedAt: 9_500 },
        { sessionId: `${agentId}-inactive`, updatedAt: 1_000 },
      ],
      invalid: [],
    }));
    const router = createRouter({
      safeReaddirAsync: vi.fn(async () => ["agent-a", "agent-b"]),
      getCachedSessionEntries,
    });
    const handler = getRouteHandler(router, "get", "/api/agents");
    const req = {};
    const res = createMockRes();

    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(nowSpy).toHaveBeenCalledTimes(1);
  });

  describe("ETag support", () => {
    it("returns ETag header with GET /api/agents", async () => {
      writeSessionsFile("agent1", { s1: { sessionId: "s1", updatedAt: Date.now() } });
      const app = createApp({ safeReaddirAsync: vi.fn(async () => ["agent1"]) });
      const res = await request(app).get("/api/agents");
      expect(res.status).toBe(200);
      expect(res.headers.etag).toBeDefined();
      expect(res.headers.etag).toMatch(/^"?/);
    });

    it("returns 304 when If-None-Match matches current ETag", async () => {
      writeSessionsFile("agent1", { s1: { sessionId: "s1", updatedAt: Date.now() } });
      const app = createApp({ safeReaddirAsync: vi.fn(async () => ["agent1"]) });

      // First request to get the ETag
      const firstRes = await request(app).get("/api/agents");
      const etag = firstRes.headers.etag;

      // Second request with matching ETag
      const secondRes = await request(app).get("/api/agents").set("If-None-Match", etag);
      expect(secondRes.status).toBe(304);
    });

    it("returns 200 with new ETag when If-None-Match is stale", async () => {
      // Use a different agent ID for the second write to avoid cache issues
      writeSessionsFile("agent1", { s1: { sessionId: "s1", updatedAt: Date.now() } });
      const app = createApp({ safeReaddirAsync: vi.fn(async () => ["agent1"]) });

      // First request to get the ETag
      const firstRes = await request(app).get("/api/agents");
      const etag = firstRes.headers.etag;

      // Clear session cache and modify the data to make ETag stale
      sessionCache.clearSessionCache();
      writeSessionsFile("agent1", {
        s1: { sessionId: "s1", updatedAt: Date.now() },
        s2: { sessionId: "s2", updatedAt: Date.now() },
      });

      // Second request with stale ETag
      const secondRes = await request(app).get("/api/agents").set("If-None-Match", etag);
      expect(secondRes.status).toBe(200);
      expect(secondRes.headers.etag).toBeDefined();
      expect(secondRes.headers.etag).not.toBe(etag);
    });
  });
});
