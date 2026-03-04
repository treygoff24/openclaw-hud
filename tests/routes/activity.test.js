import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const helpers = require("../../lib/helpers");
helpers.OPENCLAW_HOME = "/mock/home";

function createApp(overrides = {}) {
  delete require.cache[require.resolve("../../routes/activity")];
  const router = require("../../routes/activity");
  const deps = {
    safeReaddirAsync: vi.fn(async () => []),
    getCachedSessions: vi.fn(async () => null),
    tailLines: vi.fn(async () => []),
    ...overrides,
  };
  router.__setDependencies?.(deps);
  const app = express();
  app.use(router);
  return { app, deps };
}

describe("GET /api/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (Date.now.mockRestore) Date.now.mockRestore();
  });

  it("returns empty array when no agents exist", async () => {
    const { app, deps } = createApp({ safeReaddirAsync: vi.fn(async () => []) });
    const res = await request(app).get("/api/activity");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(deps.safeReaddirAsync).toHaveBeenCalledTimes(1);
  });

  it("returns events sorted by timestamp descending", async () => {
    const { app, deps } = createApp({
      safeReaddirAsync: vi.fn(async () => ["agent1"]),
      getCachedSessions: vi.fn(async () => ({ sess1: { sessionId: "s1", updatedAt: Date.now() } })),
      tailLines: vi.fn(async () => [
        JSON.stringify({ type: "message", timestamp: "2025-01-01T10:00:00Z", content: "older" }),
        JSON.stringify({ type: "message", timestamp: "2025-01-01T12:00:00Z", content: "newer" }),
      ]),
    });

    const res = await request(app).get("/api/activity");
    expect(res.body).toHaveLength(2);
    expect(res.body[0].content).toBe("newer");
    expect(res.body[1].content).toBe("older");
  });

  it("truncates content to 200 characters", async () => {
    const { app } = createApp({
      safeReaddirAsync: vi.fn(async () => ["a1"]),
      getCachedSessions: vi.fn(async () => ({ s1: { sessionId: "s1", updatedAt: Date.now() } })),
      tailLines: vi.fn(async () => [
        JSON.stringify({
          type: "msg",
          timestamp: "2025-01-01T00:00:00Z",
          content: "x".repeat(500),
        }),
      ]),
    });
    const res = await request(app).get("/api/activity");
    expect(res.body[0].content).toHaveLength(200);
  });

  it("limits results to 50 events", async () => {
    const sessions = {};
    for (let i = 0; i < 3; i++) {
      sessions[`s${i}`] = { sessionId: `s${i}`, updatedAt: Date.now() - i * 1000 };
    }

    const { app } = createApp({
      safeReaddirAsync: vi.fn(async () => Array.from({ length: 20 }, (_, i) => `agent${i}`)),
      getCachedSessions: vi.fn(async () => sessions),
      tailLines: vi.fn(async () =>
        Array.from({ length: 5 }, (_, i) => JSON.stringify({ type: "msg", timestamp: `2025-01-01T${String(i).padStart(2, "0")}:00:00Z`, content: `e${i}` })),
      ),
    });

    const res = await request(app).get("/api/activity");
    expect(res.body.length).toBeLessThanOrEqual(50);
  });

  it("includes agentId and sessionKey in each event", async () => {
    const { app } = createApp({
      safeReaddirAsync: vi.fn(async () => ["mybot"]),
      getCachedSessions: vi.fn(async () => ({ "session-key": { sessionId: "sid", updatedAt: Date.now() } })),
      tailLines: vi.fn(async () =>
        [JSON.stringify({ type: "tool", name: "read", timestamp: "2025-06-01T00:00:00Z" })],
      ),
    });

    const res = await request(app).get("/api/activity");
    expect(res.body[0].agentId).toBe("mybot");
    expect(res.body[0].sessionKey).toBe("session-key");
    expect(res.body[0].toolName).toBe("read");
  });

  it("skips events without timestamp", async () => {
    const { app } = createApp({
      safeReaddirAsync: vi.fn(async () => ["a1"]),
      getCachedSessions: vi.fn(async () => ({ s1: { sessionId: "s1", updatedAt: Date.now() } })),
      tailLines: vi.fn(async () => [
        JSON.stringify({ type: "msg", content: "no timestamp" }),
        JSON.stringify({ type: "msg", timestamp: "2025-01-01T00:00:00Z", content: "has timestamp" }),
      ]),
    });

    const res = await request(app).get("/api/activity");
    expect(res.body).toHaveLength(1);
    expect(res.body[0].content).toBe("has timestamp");
  });

  it("handles missing log files gracefully", async () => {
    const { app } = createApp({
      safeReaddirAsync: vi.fn(async () => ["a1"]),
      getCachedSessions: vi.fn(async () => ({ s1: { sessionId: "s1", updatedAt: Date.now() } })),
      tailLines: vi.fn(async () => []),
    });
    const res = await request(app).get("/api/activity");
    expect(res.body).toEqual([]);
  });

  it("uses cache for subsequent requests inside TTL", async () => {
    const getCachedSessions = vi.fn(async () => ({ s1: { sessionId: "s1", updatedAt: Date.now() } }));
    const tailLines = vi.fn(async () => [
      JSON.stringify({ type: "msg", timestamp: "2025-01-01T00:00:00Z", content: "cached" }),
    ]);
    const { app } = createApp({
      safeReaddirAsync: vi.fn(async () => ["agent1"]),
      getCachedSessions,
      tailLines,
    });

    const first = await request(app).get("/api/activity");
    const second = await request(app).get("/api/activity");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toEqual(second.body);
    expect(tailLines).toHaveBeenCalledTimes(1);
    expect(getCachedSessions).toHaveBeenCalledTimes(1);
    expect(tailLines).toHaveBeenCalledTimes(1);
  });

  it("recomputes when cache TTL expires", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(1000).mockReturnValueOnce(100000000);

    const { app } = createApp({
      safeReaddirAsync: vi.fn(async () => ["agent1"]),
      getCachedSessions: vi.fn(async () => ({ s1: { sessionId: "s1", updatedAt: 1000 } })),
      tailLines: vi.fn(async () => [
        JSON.stringify({ type: "msg", timestamp: "2025-01-01T00:00:00Z", content: "stale" }),
      ]),
    });

    await request(app).get("/api/activity");
    await request(app).get("/api/activity");
    expect(nowSpy).toHaveBeenCalled();
  });

  it("does not recompute when completion occurs past TTL start checkpoint", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(0).mockReturnValueOnce(6000).mockReturnValueOnce(6000);
    const tailLines = vi.fn(async () => [
      JSON.stringify({ type: "msg", timestamp: "2025-01-01T00:00:00Z", content: "single" }),
    ]);

    const { app } = createApp({
      safeReaddirAsync: vi.fn(async () => ["agent1"]),
      getCachedSessions: vi.fn(async () => ({ s1: { sessionId: "s1", updatedAt: 0 } })),
      tailLines,
    });

    await request(app).get("/api/activity");
    await request(app).get("/api/activity");

    expect(tailLines).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent recompute into a single in-flight computation", async () => {
    const safeReaddirAsync = vi.fn(async () => ["agent1"]);
    const getCachedSessions = vi.fn(async () => ({ s1: { sessionId: "s1", updatedAt: Date.now() } }));
    const tailLines = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return [JSON.stringify({ type: "msg", timestamp: "2025-01-01T00:00:00Z", content: "shared" })];
    });
    const { app } = createApp({ safeReaddirAsync, getCachedSessions, tailLines });

    await Promise.all([request(app).get("/api/activity"), request(app).get("/api/activity")]);
    expect(tailLines).toHaveBeenCalledTimes(1);
    expect(getCachedSessions).toHaveBeenCalledTimes(1);
  });

  it("neutralizes refresh query bypass and keeps one cached computation", async () => {
    const tailLines = vi.fn(async () => [
      JSON.stringify({ type: "msg", timestamp: "2025-01-01T00:00:00Z", content: "fresh" }),
    ]);
    const { app } = createApp({
      safeReaddirAsync: vi.fn(async () => ["agent1"]),
      getCachedSessions: vi.fn(async () => ({ s1: { sessionId: "s1", updatedAt: Date.now() } })),
      tailLines,
    });
    await request(app).get("/api/activity");
    await request(app).get("/api/activity?refresh=1");
    expect(tailLines).toHaveBeenCalledTimes(1);
  });

  it("uses name or type as content for non-string content", async () => {
    const { app } = createApp({
      safeReaddirAsync: vi.fn(async () => ["a1"]),
      getCachedSessions: vi.fn(async () => ({ s1: { sessionId: "s1", updatedAt: Date.now() } })),
      tailLines: vi.fn(async () => [
        JSON.stringify({
          type: "tool_use",
          name: "exec",
          timestamp: "2025-01-01T00:00:00Z",
          content: { result: true },
        }),
      ]),
    });
    const res = await request(app).get("/api/activity");
    expect(res.body[0].content).toBe("exec");
  });
});
