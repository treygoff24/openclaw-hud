import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";
const { createApiTailTelemetryMiddleware } = require("../../lib/api-tail-telemetry");

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
  return createAppWithTelemetry();
}

function waitForTelemetryFlush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createAppWithTelemetry({
  onTelemetry,
  appendPerfEvents,
  sampleRate = 1,
  slowRequestMs = 500,
} = {}) {
  delete require.cache[require.resolve("../../routes/model-usage")];
  const router = require("../../routes/model-usage");
  const app = express();
  if (appendPerfEvents) {
    app.use(
      createApiTailTelemetryMiddleware({
        appendPerfEvents,
        sampleRate,
        slowRequestMs,
      }),
    );
  }
  if (typeof onTelemetry === "function") {
    app.use((req, res, next) => {
      res.on("finish", () => {
        if (req.path === "/api/model-usage/monthly") {
          onTelemetry(
            res.locals?.apiTailTelemetry
              ? JSON.parse(JSON.stringify(res.locals.apiTailTelemetry))
              : null,
          );
        }
      });
      return next();
    });
  }
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

  it("captures model-usage-monthly telemetry on cache miss and hit paths", async () => {
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        aggregates: {
          byModel: [
            {
              provider: "openai",
              model: "gpt-5",
              totals: {
                input: 1200,
                output: 800,
                cacheRead: 100,
                cacheWrite: 80,
                totalTokens: 2180,
                totalCost: 7.25,
              },
            },
          ],
        },
      },
    });

    let nowValue = 40_000;
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockImplementation(() => {
      const current = nowValue;
      nowValue += 100;
      return current;
    });

    const observed = [];
    const observedApiTailTelemetry = [];
    const app = createAppWithTelemetry({
      onTelemetry: (payload) => {
        observed.push(payload);
      },
      appendPerfEvents: (events) => {
        observedApiTailTelemetry.push(events?.[0]);
      },
    });

    const missResponse = await request(app).get("/api/model-usage/monthly");
    const missTelemetry = observed.at(-1);
    await waitForTelemetryFlush();
    const missApiTailTelemetry = observedApiTailTelemetry.at(-1);

    expect(missResponse.status).toBe(200);
    expect(missTelemetry).toMatchObject({
      workload: "model-usage-monthly",
      cacheState: expect.objectContaining({ state: "miss" }),
      phases: {
        cacheLookupMs: expect.any(Number),
        gatewayFetchMs: expect.any(Number),
        normalizeMs: expect.any(Number),
        pricingRepriceMs: expect.any(Number),
        aliasMapMs: expect.any(Number),
        summaryMs: expect.any(Number),
        cacheWriteMs: expect.any(Number),
        etagSerializeMs: expect.any(Number),
      },
      counters: expect.objectContaining({
        cacheMiss: 1,
        cacheHit: 0,
        gatewayCalls: expect.any(Number),
        cacheWriteAttempted: 1,
        cacheWriteSuccess: 1,
      }),
    });

    const hitResponse = await request(app).get("/api/model-usage/monthly");
    const hitTelemetry = observed.at(-1);
    await waitForTelemetryFlush();
    const hitApiTailTelemetry = observedApiTailTelemetry.at(-1);

    expect(missApiTailTelemetry?.summary?.["apiTail.metric.cacheMiss"]?.count?.sum).toBe(1);
    expect(missApiTailTelemetry?.summary?.["apiTail.metric.cacheWriteSuccess"]?.count?.sum).toBe(1);

    expect(hitResponse.status).toBe(200);
    expect(hitResponse.body.meta.source).toBe("disk-cache");
    expect(hitTelemetry).toMatchObject({
      workload: "model-usage-monthly",
      cacheState: expect.objectContaining({ state: "hit" }),
      counters: expect.objectContaining({
        cacheHit: 1,
        cacheMiss: 0,
        gatewayCalls: expect.any(Number),
      }),
      phases: expect.objectContaining({
        cacheLookupMs: expect.any(Number),
        etagSerializeMs: expect.any(Number),
      }),
    });
    expect(hitApiTailTelemetry?.summary?.["apiTail.metric.cacheHit"]?.count?.sum).toBe(1);
    expect(hitApiTailTelemetry?.summary?.["apiTail.metric.cacheMiss"]?.count?.sum).toBe(0);
    expect(hitApiTailTelemetry?.summary?.["apiTail.metric.gatewayCalls"]?.count?.sum).toBe(0);
    expect(hitTelemetry.counters.gatewayCalls).toBe(0);
    expect(usageRpc.requestSessionsUsage).toHaveBeenCalledTimes(1);
  });

  it("refresh=1 bypasses disk cache and fetches fresh data", async () => {
    const observedApiTailTelemetry = [];
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

    const appWithTelemetry = createAppWithTelemetry({
      appendPerfEvents: (events) => {
        observedApiTailTelemetry.push(events?.[0]);
      },
    });
    
    // First request
    await request(appWithTelemetry).get("/api/model-usage/monthly");
    const callCountAfterFirst = usageRpc.requestSessionsUsage.mock.calls.length;
    
    // Second request with refresh
    const res2 = await request(appWithTelemetry).get("/api/model-usage/monthly?refresh=1");
    await waitForTelemetryFlush();
    expect(res2.status).toBe(200);
    expect(res2.body.meta.source).toBe("sessions.usage+config-reprice");
    
    // Gateway should be called again
    expect(usageRpc.requestSessionsUsage.mock.calls.length).toBeGreaterThan(callCountAfterFirst);
    expect(observedApiTailTelemetry.at(1)).toMatchObject({
      cacheState: expect.objectContaining({ state: "disabled" }),
    });
    expect(observedApiTailTelemetry.at(1)?.summary?.["apiTail.metric.cacheMiss"]?.count?.sum).toBe(1);
  });

  it("handles expired disk cache by fetching fresh data", async () => {
    // Use readMonthCacheEntry mock to simulate expired cache
    const cacheModule = require("../../lib/month-usage-cache");
    const originalReadMonthCacheEntry = cacheModule.readMonthCacheEntry;
    cacheModule.readMonthCacheEntry = vi.fn(() => null);
    
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
    cacheModule.readMonthCacheEntry = originalReadMonthCacheEntry;
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
