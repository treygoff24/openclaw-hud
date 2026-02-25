// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const usageRpc = require("../../lib/usage-rpc");
const pricing = require("../../lib/pricing");

const originalRequestSessionsUsage = usageRpc.requestSessionsUsage;
const originalLoadPricingCatalog = pricing.loadPricingCatalog;
const TEST_TZ = "America/Chicago";
const originalUsageTz = process.env.HUD_USAGE_TZ;

function createApp() {
  delete require.cache[require.resolve("../../routes/model-usage")];
  const router = require("../../routes/model-usage");
  const app = express();
  app.use(router);
  return app;
}

describe("GET /api/model-usage/live-weekly repricing", () => {
  beforeEach(() => {
    process.env.HUD_USAGE_TZ = TEST_TZ;
    vi.clearAllMocks();
    usageRpc.requestSessionsUsage = vi.fn();
  });

  afterEach(() => {
    usageRpc.requestSessionsUsage = originalRequestSessionsUsage;
    pricing.loadPricingCatalog = originalLoadPricingCatalog;
    process.env.HUD_USAGE_TZ = originalUsageTz;
    vi.restoreAllMocks();
  });

  it("reprices totals from config and ignores transcript costs", async () => {
    pricing.loadPricingCatalog = vi.fn(() =>
      pricing.buildPricingCatalog({
        models: {
          providers: {
            openai: {
              models: [
                {
                  id: "gpt-5",
                  cost: { input: 10, output: 20, cacheRead: 5, cacheWrite: 1 },
                },
              ],
            },
          },
        },
      }),
    );

    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        rows: [
          {
            provider: "openai",
            model: "gpt-5",
            totals: {
              input: 1000,
              output: 500,
              cacheRead: 200,
              cacheWrite: 100,
              totalTokens: 1800,
              totalCost: 999,
            },
          },
        ],
      },
    });

    const res = await request(createApp()).get("/api/model-usage/live-weekly");

    expect(res.status).toBe(200);
    expect(res.body.models[0].totalCost).toBeCloseTo(0.0211, 10);
    expect(res.body.totals.totalCost).toBeCloseTo(0.0211, 10);
    expect(res.body.meta.missingPricingModels).toEqual([]);
  });

  it("sets missing pricing diagnostics and zeroes cost when pricing absent", async () => {
    pricing.loadPricingCatalog = vi.fn(() =>
      pricing.buildPricingCatalog({ models: { providers: {} } }),
    );

    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        rows: [
          {
            provider: "openai",
            model: "gpt-unknown",
            totals: {
              input: 10,
              output: 10,
              cacheRead: 5,
              cacheWrite: 5,
              totalTokens: 30,
              totalCost: 123,
            },
          },
        ],
      },
    });

    const res = await request(createApp()).get("/api/model-usage/live-weekly");

    expect(res.status).toBe(200);
    expect(res.body.models[0].totalCost).toBe(0);
    expect(res.body.totals.totalCost).toBe(0);
    expect(res.body.meta.missingPricingModels).toEqual(["openai/gpt-unknown"]);
  });

  it("keeps zero-priced models at zero cost", async () => {
    pricing.loadPricingCatalog = vi.fn(() =>
      pricing.buildPricingCatalog({
        models: {
          providers: {
            anthropic: {
              models: [
                {
                  id: "claude-haiku-4",
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                },
              ],
            },
          },
        },
      }),
    );

    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        rows: [
          {
            provider: "anthropic",
            model: "claude-haiku-4",
            totals: {
              input: 10,
              output: 20,
              cacheRead: 30,
              cacheWrite: 40,
              totalTokens: 100,
              totalCost: 55,
            },
          },
        ],
      },
    });

    const res = await request(createApp()).get("/api/model-usage/live-weekly");

    expect(res.status).toBe(200);
    expect(res.body.models[0].totalCost).toBe(0);
    expect(res.body.totals.totalCost).toBe(0);
    expect(res.body.meta.missingPricingModels).toEqual([]);
  });
});
