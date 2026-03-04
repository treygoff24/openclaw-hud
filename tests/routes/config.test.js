import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const helpers = require("../../lib/helpers");
const { createApiTailTelemetryMiddleware } = require("../../lib/api-tail-telemetry");

helpers.OPENCLAW_HOME = "/mock/home";
helpers.safeJSON5 = vi.fn();
helpers.stripSecrets = vi.fn((x) => x);
const originalModelsCacheTtlMs = process.env.HUD_MODELS_CACHE_TTL_MS;

function mockConfigSources({ primary = null, legacy = null }) {
  helpers.safeJSON5.mockImplementation((fp) => {
    if (fp.endsWith("openclaw.json")) return primary;
    if (fp.endsWith("source-of-truth.json5")) return legacy;
    return null;
  });
}

function createApp({ telemetry } = {}) {
  delete require.cache[require.resolve("../../routes/config")];
  delete require.cache[require.resolve("../../routes/spawn")];

  const spawnRouter = require("../../routes/spawn");
  spawnRouter.setCachedModels = vi.fn();

  const router = require("../../routes/config");
  const app = express();
  if (telemetry) {
    app.use("/api", telemetry);
  }
  app.use(router);
  return { app, spawnRouter };
}

describe("GET /api/models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HUD_MODELS_CACHE_TTL_MS = "1000";
  });

  afterEach(() => {
    process.env.HUD_MODELS_CACHE_TTL_MS = originalModelsCacheTtlMs;
    vi.restoreAllMocks();
  });

  it("uses primary openclaw.json models and does not inject phantom hardcoded models", async () => {
    mockConfigSources({
      primary: {
        agents: {
          defaults: {
            models: {
              "openai/gpt-4.1": { alias: "gpt41" },
            },
          },
        },
      },
      legacy: {
        agents: {
          defaults: {
            models: {
              "anthropic/claude-haiku-4": { alias: "haiku" },
            },
          },
        },
      },
    });

    const { app } = createApp();
    const res = await request(app).get("/api/models");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { alias: "default", fullId: "" },
      { alias: "gpt41", fullId: "openai/gpt-4.1" },
    ]);
  });

  it("falls back to legacy source-of-truth models when primary config is missing", async () => {
    mockConfigSources({
      primary: null,
      legacy: {
        agents: {
          defaults: {
            models: {
              "openai/gpt-5": { alias: "gpt5" },
            },
          },
        },
      },
    });

    const { app } = createApp();
    const res = await request(app).get("/api/models");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { alias: "default", fullId: "" },
      { alias: "gpt5", fullId: "openai/gpt-5" },
    ]);
  });

  it("keeps config source consistent across /api/config and /api/models", async () => {
    mockConfigSources({
      primary: {
        agents: {
          defaults: {
            model: { primary: "openai/gpt-4.1" },
            models: {
              "openai/gpt-4.1": { alias: "gpt41" },
            },
          },
        },
      },
      legacy: {
        agents: {
          defaults: {
            model: { primary: "anthropic/claude-haiku-4" },
            models: {
              "anthropic/claude-haiku-4": { alias: "haiku" },
            },
          },
        },
      },
    });

    const { app } = createApp();
    const configRes = await request(app).get("/api/config");
    const modelsRes = await request(app).get("/api/models");

    expect(configRes.status).toBe(200);
    expect(configRes.body.defaultModel).toBe("openai/gpt-4.1");
    expect(modelsRes.status).toBe(200);
    expect(modelsRes.body).toEqual([
      { alias: "default", fullId: "" },
      { alias: "gpt41", fullId: "openai/gpt-4.1" },
    ]);
  });

  it("updates spawn cached models using the exact API payload (for model-picker compatibility)", async () => {
    mockConfigSources({
      primary: {
        agents: {
          defaults: {
            models: {
              "openai/gpt-5.3-codex": { alias: "vulcan" },
            },
          },
        },
      },
    });

    const created = createApp();
    const app = created.app;
    const spawnRouter = created.spawnRouter;
    const res = await request(app).get("/api/models");

    expect(res.status).toBe(200);
    expect(spawnRouter.setCachedModels).toHaveBeenCalledTimes(1);
    expect(spawnRouter.setCachedModels).toHaveBeenCalledWith(res.body);
  });

  it("adds api-tail telemetry hook metadata for /api/models", async () => {
    const appendPerfEvents = vi.fn(async () => ({ accepted: 1 }));
    const telemetry = createApiTailTelemetryMiddleware({
      appendPerfEvents,
      sampleRate: 1,
      slowRequestMs: 500,
    });
    const created = createApp({ telemetry });
    const app = created.app;

    mockConfigSources({
      primary: {
        agents: {
          defaults: {
            models: {
              "openai/gpt-5": { alias: "gpt5" },
            },
          },
        },
      },
    });

    const res = await request(app).get("/api/models").set("x-request-id", "cfg-1");
    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(appendPerfEvents).toHaveBeenCalledTimes(1);
    const event = appendPerfEvents.mock.calls[0][0][0];
    expect(event).toMatchObject({
      endpoint: "/api/models",
      workload: "models",
      requestId: "cfg-1",
    });
    expect(event.summary["apiTail.phase.diskReadMs"].durationMs.sum).toBeGreaterThanOrEqual(0);
    expect(event.summary["apiTail.cache"].cacheMiss.sum).toBe(1);
  });

  it("derives alias from model id tail when alias is absent", async () => {
    mockConfigSources({
      primary: {
        agents: {
          defaults: {
            models: {
              "google/gemini-2.5-pro": {},
            },
          },
        },
      },
    });

    const { app } = createApp();
    const res = await request(app).get("/api/models");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { alias: "default", fullId: "" },
      { alias: "gemini-2.5-pro", fullId: "google/gemini-2.5-pro" },
    ]);
  });

  it("memo-caches /api/models responses based on config file mtime/size dependencies", async () => {
    let openclawMtime = 1;
    let legacyMtime = 2;
    const fs = require("fs");
    const statSpy = vi.spyOn(fs, "statSync").mockImplementation((filePath) => {
      if (String(filePath).endsWith("openclaw.json")) {
        return { mtimeMs: openclawMtime, size: 10 };
      }
      return { mtimeMs: legacyMtime, size: 11 };
    });

    mockConfigSources({
      primary: {
        agents: {
          defaults: {
            models: {
              "openai/gpt-5": { alias: "gpt5" },
            },
          },
        },
      },
    });

    const { app, spawnRouter } = createApp();
    const first = await request(app).get("/api/models");
    const second = await request(app).get("/api/models");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(helpers.safeJSON5).toHaveBeenCalledTimes(2);

    const firstCacheState = JSON.parse(first.headers["x-hud-cache-state"]);
    const secondCacheState = JSON.parse(second.headers["x-hud-cache-state"]);
    expect(firstCacheState.state).toBe("miss");
    expect(secondCacheState.state).toBe("hit");
    expect(first.headers["x-hud-endpoint-timing-ms"]).toEqual(expect.any(String));
    expect(second.headers["x-hud-endpoint-timing-ms"]).toEqual(expect.any(String));

    const secondTiming = JSON.parse(second.headers["x-hud-endpoint-timing-ms"]);
    expect(secondTiming).toMatchObject({
      diskReadMs: 0,
      parseMs: 0,
      computeMs: expect.any(Number),
      serializeMs: expect.any(Number),
    });

    openclawMtime = 3;
    legacyMtime = 4;
    const third = await request(app).get("/api/models");

    expect(third.status).toBe(200);
    expect(helpers.safeJSON5).toHaveBeenCalledTimes(4);
    const thirdCacheState = JSON.parse(third.headers["x-hud-cache-state"]);
    expect(thirdCacheState.state).toBe("stale");

    expect(spawnRouter.setCachedModels).toHaveBeenCalledTimes(3);
    statSpy.mockRestore();
  });

  it("continues to expose timing headers and cache state headers on miss/hit", async () => {
    let openclawMtime = 1;
    let legacyMtime = 2;
    const fs = require("fs");
    vi.spyOn(fs, "statSync").mockImplementation((filePath) => {
      if (String(filePath).endsWith("openclaw.json")) {
        return { mtimeMs: openclawMtime, size: 10 };
      }
      return { mtimeMs: legacyMtime, size: 11 };
    });

    mockConfigSources({
      primary: {
        agents: {
          defaults: {
            models: {
              "openai/gpt-4.1": { alias: "gpt41" },
            },
          },
        },
      },
    });

    const created = createApp();
    const app = created.app;
    const first = await request(app).get("/api/models");

    const firstTiming = JSON.parse(first.headers["x-hud-endpoint-timing-ms"]);
    const firstState = JSON.parse(first.headers["x-hud-cache-state"]);
    expect(firstState.state).toBe("miss");
    expect(firstTiming).toEqual(
      expect.objectContaining({
        diskReadMs: expect.any(Number),
        parseMs: expect.any(Number),
        computeMs: expect.any(Number),
        serializeMs: expect.any(Number),
      }),
    );
  });
});
