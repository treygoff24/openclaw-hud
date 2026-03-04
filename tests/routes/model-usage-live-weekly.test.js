import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const usageRpc = require("../../lib/usage-rpc");
const pricing = require("../../lib/pricing");
const helpers = require("../../lib/helpers");
const { getLiveWeekWindow } = await import("../../lib/helpers.js");

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

function createApp() {
  delete require.cache[require.resolve("../../routes/model-usage")];
  const router = require("../../routes/model-usage");
  const app = express();
  app.use(router);
  return app;
}

describe("GET /api/model-usage/live-weekly", () => {
  beforeEach(() => {
    process.env.HUD_USAGE_TZ = TEST_TZ;
    process.env.HUD_USAGE_CACHE_TTL_MS = "60000";
    delete process.env.HUD_USAGE_SESSIONS_LIMIT;
    delete process.env.HUD_USAGE_MONTH_MAX_WINDOWS;
    delete process.env.HUD_USAGE_MONTH_MAX_DURATION_MS;
    delete process.env.HUD_USAGE_MONTH_MEMO_TTL_MS;
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
    helpers.OPENCLAW_HOME = "/mock/home";
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
    vi.restoreAllMocks();
  });

  it("returns contract schema keys with totals/models aggregated from sessions.usage", async () => {
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        aggregates: {
          byModel: [
            {
              provider: "openai",
              model: "gpt-5",
              totals: {
                input: 30,
                output: 20,
                cacheRead: 5,
                cacheWrite: 2,
                totalTokens: 57,
                totalCost: 1.2,
              },
            },
            {
              provider: "anthropic",
              model: "claude-4",
              totals: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                totalCost: 0,
              },
            },
          ],
        },
      },
    });

    const res = await request(createApp()).get("/api/model-usage/live-weekly");

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["meta", "models", "totals", "summary"]);

    expect(res.body.meta).toMatchObject({
      period: "live-weekly",
      tz: TEST_TZ,
      source: "sessions.usage+config-reprice",
      missingPricingModels: [],
      sessionsUsage: {
        sessionsLimit: 500,
        sessionsReturned: null,
        sessionsMayBeTruncated: false,
      },
    });

    const metaKeys = Object.keys(res.body.meta);
    expect(metaKeys).toEqual(
      expect.arrayContaining([
        "period",
        "tz",
        "weekStart",
        "now",
        "generatedAt",
        "source",
        "missingPricingModels",
      ]),
    );

    expect(Array.isArray(res.body.models)).toBe(true);
    expect(Object.keys(res.body.totals)).toEqual(
      expect.arrayContaining([
        "inputTokens",
        "outputTokens",
        "cacheReadTokens",
        "cacheWriteTokens",
        "totalTokens",
        "totalCost",
      ]),
    );

    expect(res.body.models).toHaveLength(1);
    expect(res.body.models[0]).toMatchObject({
      provider: "openai",
      model: "gpt-5",
      inputTokens: 30,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheWriteTokens: 2,
      totalTokens: 57,
      totalCost: 0.000727,
    });

    expect(res.body.totals).toMatchObject({
      inputTokens: 30,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheWriteTokens: 2,
      totalTokens: 57,
      totalCost: 0.000727,
    });

    expect(res.body.summary).toMatchObject({
      weekSpend: 0.000727,
      monthSpend: 0,
      topMonthModel: null,
    });
  });

  it("uses nested totals.cost.total when totals.cost is an object", async () => {
    pricing.repriceModelUsageRows = vi.fn((rows) => ({ rows, missingPricingModels: [] }));
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        rows: [
          {
            provider: "openai",
            model: "gpt-5",
            totals: {
              input: 3,
              output: 2,
              totalTokens: 5,
              cost: { total: 4.25 },
            },
          },
        ],
      },
    });

    const res = await request(createApp()).get("/api/model-usage/live-weekly");

    expect(res.status).toBe(200);
    expect(res.body.models).toHaveLength(1);
    expect(res.body.models[0].totalCost).toBe(4.25);
    expect(res.body.totals.totalCost).toBe(4.25);
  });

  it("is null-safe when sessions.usage returns a null result payload", async () => {
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: null,
    });

    const res = await request(createApp()).get("/api/model-usage/live-weekly");

    expect(res.status).toBe(200);
    expect(res.body.models).toEqual([]);
    expect(res.body.totals).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      totalCost: 0,
    });
  });

  it("ignores malformed rows and drops zero-token rows", async () => {
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        rows: [
          null,
          "bad-row",
          123,
          {
            provider: "openai",
            model: "gpt-5",
            totals: {
              input: 1,
              output: 2,
              totalTokens: 3,
            },
          },
          {
            provider: "openai",
            model: "gpt-5",
            totals: {
              input: 0,
              output: 0,
              totalTokens: 0,
            },
          },
        ],
      },
    });

    const res = await request(createApp()).get("/api/model-usage/live-weekly");

    expect(res.status).toBe(200);
    expect(res.body.models).toHaveLength(1);
    expect(res.body.models[0]).toMatchObject({
      provider: "openai",
      model: "gpt-5",
      totalTokens: 3,
    });
  });

  it("falls back totalTokens to input+output+cache tokens when totals.totalTokens is absent", async () => {
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        rows: [
          {
            provider: "openai",
            model: "gpt-5",
            totals: {
              input: 7,
              output: 11,
              cacheRead: 3,
              cacheWrite: 2,
            },
          },
        ],
      },
    });

    const res = await request(createApp()).get("/api/model-usage/live-weekly");

    expect(res.status).toBe(200);
    expect(res.body.models[0].totalTokens).toBe(23);
    expect(res.body.totals.totalTokens).toBe(23);
  });

  it("forwards the live-week window computed by getLiveWeekWindow", async () => {
    const now = Date.parse("2026-02-23T14:20:00-06:00");
    vi.spyOn(Date, "now").mockReturnValue(now);
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: { rows: [] },
    });

    await request(createApp()).get("/api/model-usage/live-weekly");

    const expected = getLiveWeekWindow(TEST_TZ, now);
    const weekArgs = usageRpc.requestSessionsUsage.mock.calls[0]?.[0];

    expect(usageRpc.requestSessionsUsage).toHaveBeenCalledTimes(1);
    expect(weekArgs).toEqual({
      from: expected.fromMs,
      to: expected.toMs,
      timezone: TEST_TZ,
      limit: 500,
    });
  });

  it("uses configured sessions limit and marks potential truncation diagnostics", async () => {
    process.env.HUD_USAGE_SESSIONS_LIMIT = "3";
    usageRpc.requestSessionsUsage
      .mockResolvedValueOnce({
        ok: true,
        result: {
          sessions: [{ id: "a" }, { id: "b" }, { id: "c" }],
          rows: [
            {
              provider: "openai",
              model: "gpt-5",
              totals: {
                input: 2,
                output: 1,
                totalTokens: 3,
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          sessions: [],
          rows: [
            {
              provider: "openai",
              model: "gpt-5",
              totals: {
                input: 2,
                output: 1,
                totalTokens: 3,
              },
            },
          ],
        },
      });

    const res = await request(createApp()).get("/api/model-usage/live-weekly");
    const args = usageRpc.requestSessionsUsage.mock.calls[0]?.[0];

    expect(res.status).toBe(200);
    expect(args.limit).toBe(3);
    expect(res.body.meta.sessionsUsage).toMatchObject({
      sessionsLimit: 3,
      sessionsReturned: 3,
      sessionsMayBeTruncated: true,
    });
  });

  it("adds summary with weekSpend/monthSpend/topMonthModel (monthly data from separate endpoint)", async () => {
    // Note: monthly data is now fetched from /api/model-usage/monthly
    // live-weekly only returns weekly data with placeholders for month fields
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        rows: [
          {
            provider: "openai",
            model: "gpt-5",
            totals: {
              input: 30,
              output: 20,
              cacheRead: 5,
              cacheWrite: 2,
              totalTokens: 57,
            },
          },
        ],
      },
    });

    const res = await request(createApp()).get("/api/model-usage/live-weekly");

    expect(res.status).toBe(200);
    expect(res.body.summary.weekSpend).toBeCloseTo(res.body.totals.totalCost, 12);
    // Month data is no longer collected by live-weekly endpoint
    // Clients should fetch /api/model-usage/monthly for month data
    expect(res.body.summary.monthSpend).toBe(0);
    expect(res.body.summary.topMonthModel).toBeNull();
  });

  it("clamps configured sessions limit to the safe max", async () => {
    process.env.HUD_USAGE_SESSIONS_LIMIT = "99999";
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: { rows: [] },
    });

    await request(createApp()).get("/api/model-usage/live-weekly");

    const args = usageRpc.requestSessionsUsage.mock.calls[0]?.[0];
    expect(args.limit).toBe(2000);
  });

  it("clamps configured sessions limit to the safe min", async () => {
    process.env.HUD_USAGE_SESSIONS_LIMIT = "0";
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: { rows: [] },
    });

    await request(createApp()).get("/api/model-usage/live-weekly");

    const args = usageRpc.requestSessionsUsage.mock.calls[0]?.[0];
    expect(args.limit).toBe(1);
  });

  it("serves cached live-weekly response within TTL and keeps generatedAt stable", async () => {
    process.env.HUD_USAGE_CACHE_TTL_MS = "1000";
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(1_200);

    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        rows: [
          {
            provider: "openai",
            model: "gpt-5",
            totals: {
              input: 10,
              output: 5,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 15,
              totalCost: 1,
            },
          },
        ],
      },
    });

    const app = createApp();
    const first = await request(app).get("/api/model-usage/live-weekly");
    const second = await request(app).get("/api/model-usage/live-weekly");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(usageRpc.requestSessionsUsage).toHaveBeenCalledTimes(1);
    expect(second.body.meta.generatedAt).toBe(first.body.meta.generatedAt);
  });

  it("refreshes cached live-weekly response after TTL expiry", async () => {
    process.env.HUD_USAGE_CACHE_TTL_MS = "1000";
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(2_000).mockReturnValueOnce(3_500);

    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        rows: [
          {
            provider: "openai",
            model: "gpt-5",
            totals: {
              input: 10,
              output: 5,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 15,
              totalCost: 1,
            },
          },
        ],
      },
    });

    const app = createApp();
    const first = await request(app).get("/api/model-usage/live-weekly");
    const second = await request(app).get("/api/model-usage/live-weekly");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(usageRpc.requestSessionsUsage).toHaveBeenCalledTimes(2);
    expect(second.body.meta.generatedAt).not.toBe(first.body.meta.generatedAt);
  });

  it("refreshes cached live-weekly response when pricing fingerprint changes within TTL", async () => {
    process.env.HUD_USAGE_CACHE_TTL_MS = "1000";
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(5_000).mockReturnValueOnce(5_100);

    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        rows: [
          {
            provider: "openai",
            model: "gpt-5",
            totals: {
              input: 10,
              output: 5,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 15,
              totalCost: 1,
            },
          },
        ],
      },
    });

    const app = createApp();
    const first = await request(app).get("/api/model-usage/live-weekly");
    pricing.getPricingConfigFingerprint.mockReturnValue("pricing-v2");
    const second = await request(app).get("/api/model-usage/live-weekly");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(usageRpc.requestSessionsUsage).toHaveBeenCalledTimes(2);
    expect(second.body.meta.generatedAt).not.toBe(first.body.meta.generatedAt);
  });

  it("bypasses cache when refresh=1 is provided", async () => {
    process.env.HUD_USAGE_CACHE_TTL_MS = "1000";
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(4_000).mockReturnValueOnce(4_100);

    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        rows: [
          {
            provider: "openai",
            model: "gpt-5",
            totals: {
              input: 10,
              output: 5,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 15,
              totalCost: 1,
            },
          },
        ],
      },
    });

    const app = createApp();
    const first = await request(app).get("/api/model-usage/live-weekly");
    const second = await request(app).get("/api/model-usage/live-weekly?refresh=1");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(usageRpc.requestSessionsUsage).toHaveBeenCalledTimes(2);
    expect(second.body.meta.generatedAt).not.toBe(first.body.meta.generatedAt);
  });

  it("surfaces gateway error when sessions.usage is unavailable (no fallback payload)", async () => {
    const err = new Error("Gateway error: Tool not available: sessions.usage");
    err.code = "GATEWAY_SESSIONS_USAGE_UNAVAILABLE";
    err.status = 404;
    err.gatewayCode = "TOOL_NOT_AVAILABLE";
    err.gatewayMethod = "sessions.usage";
    err.requestId = "gw-req-123";
    usageRpc.requestSessionsUsage.mockRejectedValue(err);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(createApp()).get("/api/model-usage/live-weekly");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Failed to load live weekly usage");
    expect(res.body.message).toBe("Gateway error: Tool not available: sessions.usage");
    expect(res.body.code).toBe("GATEWAY_SESSIONS_USAGE_UNAVAILABLE");
    expect(res.body.status).toBe(404);
    expect(res.body.requestId).toEqual(expect.any(String));
    expect(helpers.safeReaddir).not.toHaveBeenCalled();
    expect(helpers.safeRead).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[model-usage/live-weekly] failed",
      expect.objectContaining({
        status: 404,
        code: "GATEWAY_SESSIONS_USAGE_UNAVAILABLE",
        requestId: expect.any(String),
      }),
    );
  });

  it("returns empty live-weekly payload when gateway token is not configured", async () => {
    const err = new Error("Gateway token not configured");
    err.code = "GATEWAY_TOKEN_MISSING";
    usageRpc.requestSessionsUsage.mockRejectedValue(err);

    const res = await request(createApp()).get("/api/model-usage/live-weekly");

    expect(res.status).toBe(200);
    expect(res.body.meta.unavailable).toBe("gateway-token-missing");
    expect(res.body.models).toEqual([]);
    expect(res.body.totals).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      totalCost: 0,
    });
  });

  it("returns empty live-weekly payload when gateway is unreachable", async () => {
    const err = new Error("Gateway request failed: fetch failed");
    err.code = "GATEWAY_UNREACHABLE";
    usageRpc.requestSessionsUsage.mockRejectedValue(err);

    const res = await request(createApp()).get("/api/model-usage/live-weekly");

    expect(res.status).toBe(200);
    expect(res.body.meta.unavailable).toBe("gateway-unreachable");
    expect(res.body.models).toEqual([]);
    expect(res.body.totals.totalTokens).toBe(0);
  });

  it("returns 304 when If-None-Match matches live-weekly ETag", async () => {
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        rows: [
          {
            provider: "openai",
            model: "gpt-5",
            totals: {
              input: 10,
              output: 5,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 15,
              totalCost: 1,
            },
          },
        ],
      },
    });

    const first = await request(createApp()).get("/api/model-usage/live-weekly");
    const etag = first.headers.etag;

    const second = await request(createApp())
      .get("/api/model-usage/live-weekly")
      .set("If-None-Match", etag);

    expect(first.status).toBe(200);
    expect(second.status).toBe(304);
    expect(second.body).toEqual({});
  });
});
