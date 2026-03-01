import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const helpers = require("../../lib/helpers");
const sessionCache = require("../../lib/session-cache");
const fs = require("fs");

helpers.OPENCLAW_HOME = "/mock/home";
helpers.safeReaddirAsync = vi.fn(async () => []);
sessionCache.getCachedSessions = vi.fn(async () => null);

// Mock fs.promises.stat via vi.spyOn
vi.spyOn(fs.promises, "stat").mockResolvedValue({ isDirectory: () => true });

function createApp() {
  delete require.cache[require.resolve("../../routes/agents")];
  const router = require("../../routes/agents");
  const app = express();
  app.use(router);
  return app;
}

describe("GET /api/agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fs.promises.stat.mockResolvedValue({ isDirectory: () => true });
    helpers.safeReaddirAsync = vi.fn(async () => []);
    sessionCache.getCachedSessions = vi.fn(async () => null);
  });

  it("returns empty array when no agents exist", async () => {
    helpers.safeReaddirAsync.mockResolvedValue([]);
    const res = await request(createApp()).get("/api/agents");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns agents with session metadata sorted by most recent", async () => {
    helpers.safeReaddirAsync.mockResolvedValue(["bot-a", "bot-b"]);
    const now = Date.now();
    sessionCache.getCachedSessions.mockImplementation(async (agentId) => {
      if (agentId === "bot-a")
        return {
          "sess-1": { sessionId: "s1", updatedAt: now - 1000, label: "test", spawnDepth: 0 },
        };
      if (agentId === "bot-b")
        return { "sess-2": { sessionId: "s2", updatedAt: now - 500, label: "newer" } };
      return null;
    });
    const res = await request(createApp()).get("/api/agents");
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe("bot-b");
    expect(res.body[1].id).toBe("bot-a");
    expect(res.body[0].sessionCount).toBe(1);
  });

  it("counts active sessions correctly (within 1 hour)", async () => {
    helpers.safeReaddirAsync.mockResolvedValue(["agent1"]);
    const now = Date.now();
    sessionCache.getCachedSessions.mockResolvedValue({
      s1: { sessionId: "s1", updatedAt: now - 1000 },
      s2: { sessionId: "s2", updatedAt: now - 7200000 },
    });
    const res = await request(createApp()).get("/api/agents");
    expect(res.body[0].activeSessions).toBe(1);
    expect(res.body[0].sessionCount).toBe(2);
  });

  it("filters out non-directory entries", async () => {
    helpers.safeReaddirAsync.mockResolvedValue(["agent1", "file.txt"]);
    fs.promises.stat.mockImplementation(async (fp) => ({
      isDirectory: () => !fp.includes("file.txt"),
    }));
    sessionCache.getCachedSessions.mockResolvedValue(null);
    const res = await request(createApp()).get("/api/agents");
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("agent1");
  });

  it("handles missing sessions.json gracefully", async () => {
    helpers.safeReaddirAsync.mockResolvedValue(["agent1"]);
    sessionCache.getCachedSessions.mockResolvedValue(null);
    const res = await request(createApp()).get("/api/agents");
    expect(res.body[0].sessions).toEqual([]);
    expect(res.body[0].sessionCount).toBe(0);
  });

  it("enriches agent sessions with role, alias, model, and fullSlug metadata", async () => {
    helpers.getModelAliasMap = vi.fn(() => ({
      "anthropic/claude-sonnet-4": { alias: "sonnet" },
      "openai/gpt-4o": { alias: "gpt4o" },
    }));
    helpers.safeReaddirAsync.mockResolvedValue(["agent-a"]);
    const now = Date.now();
    sessionCache.getCachedSessions.mockImplementation(async (agentId) => {
      if (agentId !== "agent-a") return null;
      return {
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
      };
    });

    const res = await request(createApp()).get("/api/agents");
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
    expect(helpers.getModelAliasMap).toHaveBeenCalledTimes(1);
  });
});
