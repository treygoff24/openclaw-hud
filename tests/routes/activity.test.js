import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const helpers = require("../../lib/helpers");

helpers.OPENCLAW_HOME = "/mock/home";
helpers.safeJSON = vi.fn();
helpers.safeReaddir = vi.fn(() => []);
helpers.safeRead = vi.fn();

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
  });

  it("returns empty array when no agents exist", async () => {
    helpers.safeReaddir.mockReturnValue([]);
    const res = await request(createApp()).get("/api/activity");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns events sorted by timestamp descending", async () => {
    helpers.safeReaddir.mockReturnValue(["agent1"]);
    helpers.safeJSON.mockReturnValue({ sess1: { sessionId: "s1", updatedAt: Date.now() } });
    const lines = [
      JSON.stringify({ type: "message", timestamp: "2025-01-01T10:00:00Z", content: "older" }),
      JSON.stringify({ type: "message", timestamp: "2025-01-01T12:00:00Z", content: "newer" }),
    ];
    helpers.safeRead.mockReturnValue(lines.join("\n"));
    const res = await request(createApp()).get("/api/activity");
    expect(res.body).toHaveLength(2);
    expect(res.body[0].content).toBe("newer");
    expect(res.body[1].content).toBe("older");
  });

  it("truncates content to 200 characters", async () => {
    helpers.safeReaddir.mockReturnValue(["a1"]);
    helpers.safeJSON.mockReturnValue({ s1: { sessionId: "s1", updatedAt: Date.now() } });
    const longContent = "x".repeat(500);
    helpers.safeRead.mockReturnValue(
      JSON.stringify({ type: "msg", timestamp: "2025-01-01T00:00:00Z", content: longContent }),
    );
    const res = await request(createApp()).get("/api/activity");
    expect(res.body[0].content).toHaveLength(200);
  });

  it("limits results to 50 events", async () => {
    helpers.safeReaddir.mockReturnValue(Array.from({ length: 20 }, (_, i) => `agent${i}`));
    const sessions = {};
    for (let i = 0; i < 3; i++)
      sessions[`s${i}`] = { sessionId: `s${i}`, updatedAt: Date.now() - i * 1000 };
    helpers.safeJSON.mockReturnValue(sessions);
    const lines = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({
        type: "msg",
        timestamp: `2025-01-01T${String(i).padStart(2, "0")}:00:00Z`,
        content: `e${i}`,
      }),
    ).join("\n");
    helpers.safeRead.mockReturnValue(lines);
    const res = await request(createApp()).get("/api/activity");
    expect(res.body.length).toBeLessThanOrEqual(50);
  });

  it("includes agentId and sessionKey in each event", async () => {
    helpers.safeReaddir.mockReturnValue(["mybot"]);
    helpers.safeJSON.mockReturnValue({
      "session-key": { sessionId: "sid", updatedAt: Date.now() },
    });
    helpers.safeRead.mockReturnValue(
      JSON.stringify({ type: "tool", name: "read", timestamp: "2025-06-01T00:00:00Z" }),
    );
    const res = await request(createApp()).get("/api/activity");
    expect(res.body[0].agentId).toBe("mybot");
    expect(res.body[0].sessionKey).toBe("session-key");
    expect(res.body[0].toolName).toBe("read");
  });

  it("skips events without timestamp", async () => {
    helpers.safeReaddir.mockReturnValue(["a1"]);
    helpers.safeJSON.mockReturnValue({ s1: { sessionId: "s1", updatedAt: Date.now() } });
    const lines = [
      JSON.stringify({ type: "msg", content: "no timestamp" }),
      JSON.stringify({ type: "msg", timestamp: "2025-01-01T00:00:00Z", content: "has timestamp" }),
    ];
    helpers.safeRead.mockReturnValue(lines.join("\n"));
    const res = await request(createApp()).get("/api/activity");
    expect(res.body).toHaveLength(1);
    expect(res.body[0].content).toBe("has timestamp");
  });

  it("handles missing log files gracefully", async () => {
    helpers.safeReaddir.mockReturnValue(["a1"]);
    helpers.safeJSON.mockReturnValue({ s1: { sessionId: "s1", updatedAt: Date.now() } });
    helpers.safeRead.mockReturnValue(null);
    const res = await request(createApp()).get("/api/activity");
    expect(res.body).toEqual([]);
  });

  it("uses name or type as content for non-string content", async () => {
    helpers.safeReaddir.mockReturnValue(["a1"]);
    helpers.safeJSON.mockReturnValue({ s1: { sessionId: "s1", updatedAt: Date.now() } });
    helpers.safeRead.mockReturnValue(
      JSON.stringify({
        type: "tool_use",
        name: "exec",
        timestamp: "2025-01-01T00:00:00Z",
        content: { result: true },
      }),
    );
    const res = await request(createApp()).get("/api/activity");
    expect(res.body[0].content).toBe("exec");
  });
});
