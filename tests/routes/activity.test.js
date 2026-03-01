import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const helpers = require("../../lib/helpers");
const sessionCache = require("../../lib/session-cache");
const tailReader = require("../../lib/tail-reader");

helpers.OPENCLAW_HOME = "/mock/home";
helpers.safeReaddirAsync = vi.fn(async () => []);
sessionCache.getCachedSessions = vi.fn(async () => null);
tailReader.tailLines = vi.fn(async () => []);

function createApp() {
  delete require.cache[require.resolve("../../routes/activity")];
  const router = require("../../routes/activity");
  const app = express();
  app.use(router);
  return app;
}

describe("GET /api/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    helpers.safeReaddirAsync = vi.fn(async () => []);
    sessionCache.getCachedSessions = vi.fn(async () => null);
    tailReader.tailLines = vi.fn(async () => []);
  });

  it("returns empty array when no agents exist", async () => {
    helpers.safeReaddirAsync.mockResolvedValue([]);
    const res = await request(createApp()).get("/api/activity");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns events sorted by timestamp descending", async () => {
    helpers.safeReaddirAsync.mockResolvedValue(["agent1"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      sess1: { sessionId: "s1", updatedAt: Date.now() },
    });
    const lines = [
      JSON.stringify({ type: "message", timestamp: "2025-01-01T10:00:00Z", content: "older" }),
      JSON.stringify({ type: "message", timestamp: "2025-01-01T12:00:00Z", content: "newer" }),
    ];
    tailReader.tailLines.mockResolvedValue(lines);
    const res = await request(createApp()).get("/api/activity");
    expect(res.body).toHaveLength(2);
    expect(res.body[0].content).toBe("newer");
    expect(res.body[1].content).toBe("older");
  });

  it("truncates content to 200 characters", async () => {
    helpers.safeReaddirAsync.mockResolvedValue(["a1"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      s1: { sessionId: "s1", updatedAt: Date.now() },
    });
    const longContent = "x".repeat(500);
    tailReader.tailLines.mockResolvedValue([
      JSON.stringify({ type: "msg", timestamp: "2025-01-01T00:00:00Z", content: longContent }),
    ]);
    const res = await request(createApp()).get("/api/activity");
    expect(res.body[0].content).toHaveLength(200);
  });

  it("limits results to 50 events", async () => {
    helpers.safeReaddirAsync.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => `agent${i}`),
    );
    const sessions = {};
    for (let i = 0; i < 3; i++)
      sessions[`s${i}`] = { sessionId: `s${i}`, updatedAt: Date.now() - i * 1000 };
    sessionCache.getCachedSessions.mockResolvedValue(sessions);
    const lines = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({
        type: "msg",
        timestamp: `2025-01-01T${String(i).padStart(2, "0")}:00:00Z`,
        content: `e${i}`,
      }),
    );
    tailReader.tailLines.mockResolvedValue(lines);
    const res = await request(createApp()).get("/api/activity");
    expect(res.body.length).toBeLessThanOrEqual(50);
  });

  it("includes agentId and sessionKey in each event", async () => {
    helpers.safeReaddirAsync.mockResolvedValue(["mybot"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      "session-key": { sessionId: "sid", updatedAt: Date.now() },
    });
    tailReader.tailLines.mockResolvedValue([
      JSON.stringify({ type: "tool", name: "read", timestamp: "2025-06-01T00:00:00Z" }),
    ]);
    const res = await request(createApp()).get("/api/activity");
    expect(res.body[0].agentId).toBe("mybot");
    expect(res.body[0].sessionKey).toBe("session-key");
    expect(res.body[0].toolName).toBe("read");
  });

  it("skips events without timestamp", async () => {
    helpers.safeReaddirAsync.mockResolvedValue(["a1"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      s1: { sessionId: "s1", updatedAt: Date.now() },
    });
    tailReader.tailLines.mockResolvedValue([
      JSON.stringify({ type: "msg", content: "no timestamp" }),
      JSON.stringify({ type: "msg", timestamp: "2025-01-01T00:00:00Z", content: "has timestamp" }),
    ]);
    const res = await request(createApp()).get("/api/activity");
    expect(res.body).toHaveLength(1);
    expect(res.body[0].content).toBe("has timestamp");
  });

  it("handles missing log files gracefully", async () => {
    helpers.safeReaddirAsync.mockResolvedValue(["a1"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      s1: { sessionId: "s1", updatedAt: Date.now() },
    });
    tailReader.tailLines.mockResolvedValue([]);
    const res = await request(createApp()).get("/api/activity");
    expect(res.body).toEqual([]);
  });

  it("uses name or type as content for non-string content", async () => {
    helpers.safeReaddirAsync.mockResolvedValue(["a1"]);
    sessionCache.getCachedSessions.mockResolvedValue({
      s1: { sessionId: "s1", updatedAt: Date.now() },
    });
    tailReader.tailLines.mockResolvedValue([
      JSON.stringify({
        type: "tool_use",
        name: "exec",
        timestamp: "2025-01-01T00:00:00Z",
        content: { result: true },
      }),
    ]);
    const res = await request(createApp()).get("/api/activity");
    expect(res.body[0].content).toBe("exec");
  });
});
