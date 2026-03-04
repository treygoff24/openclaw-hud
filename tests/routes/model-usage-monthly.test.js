import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";

const usageRpc = require("../../lib/usage-rpc");
const pricing = require("../../lib/pricing");
const helpers = require("../../lib/helpers");

const originalRequestSessionsUsage = usageRpc.requestSessionsUsage;
const originalLoadPricingCatalog = pricing.loadPricingCatalog;
const originalRepriceModelUsageRows = pricing.repriceModelUsageRows;
const originalGetPricingConfigFingerprint = pricing.getPricingConfigFingerprint;
const originalSafeReaddir = helpers.safeReaddir;
const originalSafeRead = helpers.safeRead;
const originalOpenclawHome = helpers.OPENCLAW_HOME;
const TEST_TZ = "America/Chicago";
const originalUsageTz = process.env.HUD_USAGE_TZ;
const originalUsageCacheTtlMs = process.env.HUD_USAGE_CACHE_TTL_MS;
const originalUsageSessionsLimit = process.env.HUD_USAGE_SESSIONS_LIMIT;
const originalMonthUsageMaxWindows = process.env.HUD_USAGE_MONTH_MAX_WINDOWS;
const originalMonthUsageMaxDurationMs = process.env.HUD_USAGE_MONTH_MAX_DURATION_MS;
const originalMonthUsageMemoTtlMs = process.env.HUD_USAGE_MONTH_MEMO_TTL_MS;
const originalMonthUsageDiskTtlMs = process.env.HUD_USAGE_MONTH_DISK_TTL_MS;

function createApp() {
  delete require.cache[require.resolve("../../routes/model-usage")];
  const router = require("../../routes/model-usage");
  const app = express();
  app.use(router);
  return app;
}

describe("GET /api/model-usage/monthly", () => {
  let testCacheDir;

  beforeEach(() => {
    process.env.HUD_USAGE_TZ = TEST_TZ;
    process.env.HUD_USAGE_CACHE_TTL_MS = "60000";
    process.env.HUD_USAGE_MONTH_DISK_TTL_MS = "300000"; // 5 min for tests
    delete process.env.HUD_USAGE_SESSIONS_LIMIT;
    delete process.env.HUD_USAGE_MONTH_MAX_WINDOWS;
    delete process.env.HUD_USAGE_MONTH_MAX_DURATION_MS;
    delete process.env.HUD_USAGE_MONTH_MEMO_TTL_MS;
    
    testCacheDir = path.join("/tmp", `hud-test-cache-${Date.now()}`);
    helpers.OPENCLAW_HOME = testCacheDir;
    
    vi.clearAllMocks();
    usageRpc.requestSessionsUsage = vi.fn();
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
    pricing.getPricingConfigFingerprint = vi.fn(() => "pricing-v1");
    helpers.safeReaddir = vi.fn(() => []);
    helpers.safeRead = vi.fn(() => null);
  });

  afterEach(() => {
    usageRpc.requestSessionsUsage = originalRequestSessionsUsage;
    pricing.loadPricingCatalog = originalLoadPricingCatalog;
    pricing.repriceModelUsageRows = originalRepriceModelUsageRows;
    pricing.getPricingConfigFingerprint = originalGetPricingConfigFingerprint;
    helpers.safeReaddir = originalSafeReaddir;
    helpers.safeRead = originalSafeRead;
    helpers.OPENCLAW_HOME = originalOpenclawHome;
    process.env.HUD_USAGE_TZ = originalUsageTz;
    process.env.HUD_USAGE_CACHE_TTL_MS = originalUsageCacheTtlMs;
    if (originalUsageSessionsLimit === undefined) delete process.env.HUD_USAGE_SESSIONS_LIMIT;
    else process.env.HUD_USAGE_SESSIONS_LIMIT = originalUsageSessionsLimit;
    if (originalMonthUsageMaxWindows === undefined) delete process.env.HUD_USAGE_MONTH_MAX_WINDOWS;
    else process.env.HUD_USAGE_MONTH_MAX_WINDOWS = originalMonthUsageMaxWindows;
    if (originalMonthUsageMaxDurationMs === undefined)
      delete process.env.HUD_USAGE_MONTH_MAX_DURATION_MS;
    else process.env.HUD_USAGE_MONTH_MAX_DURATION_MS = originalMonthUsageMaxDurationMs;
    if (originalMonthUsageMemoTtlMs === undefined) delete process.env.HUD_USAGE_MONTH_MEMO_TTL_MS;
    else process.env.HUD_USAGE_MONTH_MEMO_TTL_MS = originalMonthUsageMemoTtlMs;
    if (originalMonthUsageDiskTtlMs === undefined) delete process.env.HUD_USAGE_MONTH_DISK_TTL_MS;
    else process.env.HUD_USAGE_MONTH_DISK_TTL_MS = originalMonthUsageDiskTtlMs;
    vi.restoreAllMocks();
    
    // Cleanup test cache directory
    try {
      if (fs.existsSync(testCacheDir)) {
        fs.rmSync(testCacheDir, { recursive: true, force: true });
      }
    } catch (e) {
      // ignore cleanup errors
    }
  });

  it("returns month-to-date usage data with correct schema", async () => {
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        aggregates: {
          byModel: [
            {
              provider: "openai",
              model: "gpt-5",
              totals: {
                input: 3000,
                output: 2000,
                cacheRead: 500,
                cacheWrite: 200,
                totalTokens: 5700,
                totalCost: 12.5,
              },
            },
          ],
        },
      },
    });

    const res = await request(createApp()).get("/api/model-usage/monthly");

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["meta", "models", "totals", "summary"]);

    expect(res.body.meta).toMatchObject({
      period: "monthly",
      tz: TEST_TZ,
      source: "sessions.usage+config-reprice",
    });

    expect(res.body.meta.sessionsUsage).toMatchObject({
      sessionsLimit: 500,
      isPartial: expect.any(Boolean),
      windowsRequested: expect.any(Number),
    });

    expect(res.body.totals).toMatchObject({
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      cacheReadTokens: expect.any(Number),
      cacheWriteTokens: expect.any(Number),
      totalTokens: expect.any(Number),
      totalCost: expect.any(Number),
    });

    expect(Array.isArray(res.body.models)).toBe(true);
    expect(res.body.summary).toMatchObject({
      monthSpend: expect.any(Number),
      topMonthModel: expect.any(Object),
    });
  });

  it("caches monthly data to disk and serves from cache on subsequent requests", async () => {
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        aggregates: {
          byModel: [
            {
              provider: "openai",
              model: "gpt-5",
              totals: {
                input: 1000,
                output: 500,
                cacheRead: 100,
                cacheWrite: 50,
                totalTokens: 1650,
                totalCost: 5.0,
              },
            },
          ],
        },
      },
    });

    const app = createApp();
    
    // First request - should hit the gateway
    const res1 = await request(app).get("/api/model-usage/monthly");
    expect(res1.status).toBe(200);
    expect(res1.body.meta.source).toBe("sessions.usage+config-reprice");
    
    // Verify gateway was called
    expect(usageRpc.requestSessionsUsage).toHaveBeenCalled();
    const callCount = usageRpc.requestSessionsUsage.mock.calls.length;
    expect(callCount).toBeGreaterThan(0);
    
    // Second request - should serve from disk cache
    const res2 = await request(app).get("/api/model-usage/monthly");
    expect(res2.status).toBe(200);
    expect(res2.body.meta.source).toBe("disk-cache");
    
    // Gateway should not be called again (same call count)
    expect(usageRpc.requestSessionsUsage).toHaveBeenCalledTimes(callCount);
  });

  it("refresh=1 bypasses disk cache and fetches fresh data", async () => {
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        aggregates: {
          byModel: [
            {
              provider: "openai",
              model: "gpt-5",
              totals: {
                input: 1000,
                output: 500,
                totalTokens: 1500,
                totalCost: 5.0,
              },
            },
          ],
        },
      },
    });

    const app = createApp();
    
    // First request
    await request(app).get("/api/model-usage/monthly");
    const callCountAfterFirst = usageRpc.requestSessionsUsage.mock.calls.length;
    
    // Second request with refresh
    const res2 = await request(app).get("/api/model-usage/monthly?refresh=1");
    expect(res2.status).toBe(200);
    expect(res2.body.meta.source).toBe("sessions.usage+config-reprice");
    
    // Gateway should be called again
    expect(usageRpc.requestSessionsUsage.mock.calls.length).toBeGreaterThan(callCountAfterFirst);
  });

  it("handles expired disk cache by fetching fresh data", async () => {
    // Use readFreshMonthCache mock to simulate expired cache
    const cacheModule = require("../../lib/month-usage-cache");
    const originalReadFresh = cacheModule.readFreshMonthCache;
    cacheModule.readFreshMonthCache = vi.fn(() => null);
    
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        aggregates: {
          byModel: [
            {
              provider: "openai",
              model: "gpt-5",
              totals: {
                input: 1000,
                output: 500,
                totalTokens: 1500,
                totalCost: 5.0,
              },
            },
          ],
        },
      },
    });

    const app = createApp();
    
    // First request
    await request(app).get("/api/model-usage/monthly");
    const callCountAfterFirst = usageRpc.requestSessionsUsage.mock.calls.length;
    expect(callCountAfterFirst).toBeGreaterThan(0);
    
    // Second request - should fetch fresh (cache expired)
    const res2 = await request(app).get("/api/model-usage/monthly");
    expect(res2.status).toBe(200);
    
    // Gateway should be called again
    expect(usageRpc.requestSessionsUsage.mock.calls.length).toBeGreaterThan(callCountAfterFirst);
    
    // Restore
    cacheModule.readFreshMonthCache = originalReadFresh;
  });

  it("returns error when gateway is unavailable", async () => {
    // Create error with proper code that matches the error handling in the route
    const gatewayError = Object.assign(new Error("Gateway token not configured"), {
      code: "GATEWAY_TOKEN_MISSING",
    });
    usageRpc.requestSessionsUsage.mockRejectedValue(gatewayError);

    // Use refresh=1 to bypass any cache
    const res = await request(createApp()).get("/api/model-usage/monthly?refresh=1");

    expect(res.status).toBe(503);
    expect(res.body.error).toContain("Gateway unavailable");
  });

  it("includes diagnostics about window splitting and truncation", async () => {
    // Simulate truncated response that needs window splitting
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        sessions: Array(500).fill({
          provider: "openai",
          model: "gpt-5",
          inputTokens: 100,
          outputTokens: 50,
        }),
        aggregates: {
          byModel: [{
            provider: "openai",
            model: "gpt-5",
            totals: {
              input: 50000,
              output: 25000,
              totalTokens: 75000,
              totalCost: 50.0,
            },
          }],
        },
      },
    });

    const res = await request(createApp()).get("/api/model-usage/monthly");

    expect(res.status).toBe(200);
    expect(res.body.meta.sessionsUsage).toMatchObject({
      isPartial: expect.any(Boolean),
      partialReasons: expect.any(Array),
      windowsRequested: expect.any(Number),
      windowsSplit: expect.any(Number),
      truncatedWindows: expect.any(Number),
    });
  });

  it("returns 304 when If-None-Match matches monthly ETag", async () => {
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        rows: [
          {
            provider: "openai",
            model: "gpt-5",
            totals: {
              input: 3000,
              output: 2000,
              cacheRead: 500,
              cacheWrite: 200,
              totalTokens: 5700,
              totalCost: 12.5,
            },
          },
        ],
      },
    });

    const first = await request(createApp()).get("/api/model-usage/monthly");
    const etag = first.headers.etag;

    const second = await request(createApp())
      .get("/api/model-usage/monthly")
      .set("If-None-Match", etag);

    expect(first.status).toBe(200);
    expect(second.status).toBe(304);
    expect(second.body).toEqual({});
  });

  it("keeps monthly ETag stable across per-request metadata fields", async () => {
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        rows: [
          {
            provider: "openai",
            model: "gpt-5",
            totals: {
              input: 3000,
              output: 2000,
              cacheRead: 500,
              cacheWrite: 200,
              totalTokens: 5700,
              totalCost: 12.5,
            },
          },
        ],
      },
    });

    const first = await request(createApp()).get("/api/model-usage/monthly");
    const etag = first.headers.etag;
    const second = await request(createApp())
      .get("/api/model-usage/monthly")
      .set("If-None-Match", etag);

    expect(first.status).toBe(200);
    expect(second.status).toBe(304);
  });
});
