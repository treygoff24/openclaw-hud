import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const helpers = require("../../lib/helpers");
const { createApiTailTelemetryMiddleware } = require("../../lib/api-tail-telemetry");

helpers.OPENCLAW_HOME = "/mock/home";
helpers.safeReaddir = vi.fn(() => []);
helpers.safeRead = vi.fn(() => null);
const originalLegacyModelUsageCacheTtlMs = process.env.HUD_MODEL_USAGE_CACHE_TTL_MS;

function createApp() {
  return createAppWithTelemetry();
}

function createAppWithTelemetry({ telemetry } = {}) {
  delete require.cache[require.resolve("../../routes/model-usage.js")];
  const router = require("../../routes/model-usage.js");
  const app = express();
  if (telemetry) {
    app.use("/api", telemetry);
  }
  app.use(router);
  return app;
}

describe("model-usage route seam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HUD_MODEL_USAGE_CACHE_TTL_MS = "1000";
    vi.spyOn(require("fs"), "statSync").mockReturnValue({ mtimeMs: 1, size: 10 });
  });

  afterEach(() => {
    process.env.HUD_MODEL_USAGE_CACHE_TTL_MS = originalLegacyModelUsageCacheTtlMs;
    vi.restoreAllMocks();
  });

  it("serves legacy /api/model-usage endpoint from dedicated route module", async () => {
    helpers.safeReaddir.mockImplementation((fp) => {
      if (fp === "/mock/home/agents") return ["agent-a"];
      if (fp === "/mock/home/agents/agent-a/sessions") return ["sess-1.jsonl"];
      return [];
    });

    helpers.safeRead.mockImplementation((fp) => {
      if (fp === "/mock/home/agents/agent-a/sessions/sess-1.jsonl") {
        return JSON.stringify({
          type: "message",
          message: {
            model: "openai/gpt-5",
            usage: {
              input: 10,
              output: 5,
              totalTokens: 15,
              cost: { total: 0.01 },
            },
          },
        });
      }
      return null;
    });

    const res = await request(createApp()).get("/api/model-usage");

    expect(res.status).toBe(200);
    expect(res.body["openai/gpt-5"].totalTokens).toBe(15);
    expect(res.body["openai/gpt-5"].agents["agent-a"].totalTokens).toBe(15);
  });

  it("adds api-tail telemetry hook metadata for /api/model-usage", async () => {
    const appendPerfEvents = vi.fn(async () => ({ accepted: 1 }));
    const telemetry = createApiTailTelemetryMiddleware({
      appendPerfEvents,
      sampleRate: 1,
      slowRequestMs: 500,
    });
    const app = createAppWithTelemetry({ telemetry });

    helpers.safeReaddir.mockImplementation((fp) => {
      if (fp === "/mock/home/agents") return ["agent-a"];
      if (fp === "/mock/home/agents/agent-a/sessions") return ["sess-1.jsonl"];
      return [];
    });
    helpers.safeRead.mockImplementation((fp) => {
      if (fp === "/mock/home/agents/agent-a/sessions/sess-1.jsonl") {
        return JSON.stringify({
          type: "message",
          message: {
            model: "openai/gpt-5",
            usage: {
              input: 10,
              output: 5,
              totalTokens: 15,
              cost: { total: 0.01 },
            },
          },
        });
      }
      return null;
    });

    const res = await request(app).get("/api/model-usage").set("x-request-id", "usage-1");
    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(appendPerfEvents).toHaveBeenCalledTimes(1);
    const event = appendPerfEvents.mock.calls[0][0][0];
    expect(event).toMatchObject({
      endpoint: "/api/model-usage",
      workload: "model-usage",
      requestId: "usage-1",
    });
    expect(event.summary["apiTail.phase.computeMs"].durationMs.sum).toBeGreaterThanOrEqual(0);
    expect(event.summary["apiTail.cache"].cacheMiss.sum).toBe(1);
  });

  it("server wires dedicated model-usage route module", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const serverPath = path.default.join(process.cwd(), "server.js");
    const content = fs.readFileSync(serverPath, "utf-8");

    expect(content).toMatch(/require\(["']\.\/routes\/model-usage["']\)/);
  });

  it("memo-caches /api/model-usage with dependency (mtime/size) invalidation", async () => {
    let sessionMtime = 1;
    const fs = require("fs");
    const statSpy = vi.spyOn(fs, "statSync").mockImplementation((filePath) => {
      if (String(filePath).includes("sess-1.jsonl")) {
        return { mtimeMs: sessionMtime, size: 10 };
      }
      if (String(filePath).endsWith("/mock/home/agents")) {
        return { mtimeMs: 2, size: 5 };
      }
      return { mtimeMs: 1, size: 10 };
    });

    helpers.safeReaddir.mockImplementation((fp) => {
      if (fp === "/mock/home/agents") return ["agent-a"];
      if (fp === "/mock/home/agents/agent-a/sessions") return ["sess-1.jsonl"];
      return [];
    });
    helpers.safeRead.mockImplementation((fp) => {
      if (fp === "/mock/home/agents/agent-a/sessions/sess-1.jsonl") {
        return JSON.stringify({
          type: "message",
          message: {
            model: "openai/gpt-5",
            usage: {
              input: 10,
              output: 5,
              totalTokens: 15,
              cost: { total: 0.01 },
            },
          },
        });
      }
      return null;
    });

    const app = createApp();
    const first = await request(app).get("/api/model-usage");
    const second = await request(app).get("/api/model-usage");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(helpers.safeRead).toHaveBeenCalledTimes(1);
    expect(JSON.parse(first.headers["x-hud-cache-state"]).state).toBe("miss");
    expect(JSON.parse(second.headers["x-hud-cache-state"]).state).toBe("hit");

    sessionMtime = 2;
    const third = await request(app).get("/api/model-usage");
    expect(third.status).toBe(200);
    expect(helpers.safeRead).toHaveBeenCalledTimes(2);
    expect(JSON.parse(third.headers["x-hud-cache-state"]).state).toBe("stale");

    const timing = JSON.parse(third.headers["x-hud-endpoint-timing-ms"]);
    expect(timing).toEqual(
      expect.objectContaining({
        diskReadMs: expect.any(Number),
        parseMs: expect.any(Number),
        computeMs: expect.any(Number),
        serializeMs: expect.any(Number),
      }),
    );

    statSpy.mockRestore();
  });

  it("returns 304 when cached ETag matches and payload is unchanged", async () => {
    helpers.safeReaddir.mockImplementation((fp) => {
      if (fp === "/mock/home/agents") return ["agent-a"];
      if (fp === "/mock/home/agents/agent-a/sessions") return ["sess-1.jsonl"];
      return [];
    });
    helpers.safeRead.mockImplementation((fp) => {
      if (fp === "/mock/home/agents/agent-a/sessions/sess-1.jsonl") {
        return JSON.stringify({
          type: "message",
          message: {
            model: "openai/gpt-5",
            usage: {
              input: 10,
              output: 5,
              totalTokens: 15,
              cost: { total: 0.01 },
            },
          },
        });
      }
      return null;
    });

    const app = createApp();
    const first = await request(app).get("/api/model-usage");
    expect(first.status).toBe(200);

    const etag = first.headers.etag;
    const second = await request(app).get("/api/model-usage").set("If-None-Match", etag);
    expect(second.status).toBe(304);
  });
});
