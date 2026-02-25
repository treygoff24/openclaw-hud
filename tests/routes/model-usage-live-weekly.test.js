import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const usageRpc = require('../../lib/usage-rpc');
const pricing = require('../../lib/pricing');
const { getLiveWeekWindow } = await import('../../lib/helpers.js');

const originalRequestSessionsUsage = usageRpc.requestSessionsUsage;
const originalLoadPricingCatalog = pricing.loadPricingCatalog;
const originalRepriceModelUsageRows = pricing.repriceModelUsageRows;
const originalGetPricingConfigFingerprint = pricing.getPricingConfigFingerprint;
const TEST_TZ = 'America/Chicago';
const originalUsageTz = process.env.HUD_USAGE_TZ;
const originalUsageCacheTtlMs = process.env.HUD_USAGE_CACHE_TTL_MS;

function createApp() {
  delete require.cache[require.resolve('../../routes/model-usage')];
  const router = require('../../routes/model-usage');
  const app = express();
  app.use(router);
  return app;
}

describe('GET /api/model-usage/live-weekly', () => {
  beforeEach(() => {
    process.env.HUD_USAGE_TZ = TEST_TZ;
    process.env.HUD_USAGE_CACHE_TTL_MS = '15000';
    vi.clearAllMocks();
    usageRpc.requestSessionsUsage = vi.fn();
    pricing.loadPricingCatalog = vi.fn(() =>
      pricing.buildPricingCatalog({
        models: {
          providers: {
            openai: {
              models: [
                {
                  id: 'gpt-5',
                  cost: { input: 10, output: 20, cacheRead: 5, cacheWrite: 1 },
                },
              ],
            },
          },
        },
      }),
    );
    pricing.getPricingConfigFingerprint = vi.fn(() => 'pricing-v1');
  });

  afterEach(() => {
    usageRpc.requestSessionsUsage = originalRequestSessionsUsage;
    pricing.loadPricingCatalog = originalLoadPricingCatalog;
    pricing.repriceModelUsageRows = originalRepriceModelUsageRows;
    pricing.getPricingConfigFingerprint = originalGetPricingConfigFingerprint;
    process.env.HUD_USAGE_TZ = originalUsageTz;
    process.env.HUD_USAGE_CACHE_TTL_MS = originalUsageCacheTtlMs;
    vi.restoreAllMocks();
  });

  it('returns contract schema keys with totals/models aggregated from sessions.usage', async () => {
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        aggregates: {
          byModel: [
            {
              provider: 'openai',
              model: 'gpt-5',
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
              provider: 'anthropic',
              model: 'claude-4',
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

    const res = await request(createApp()).get('/api/model-usage/live-weekly');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['meta', 'models', 'totals']);

    expect(res.body.meta).toMatchObject({
      period: 'live-weekly',
      tz: TEST_TZ,
      source: 'sessions.usage+config-reprice',
      missingPricingModels: [],
    });

    const metaKeys = Object.keys(res.body.meta);
    expect(metaKeys).toEqual(
      expect.arrayContaining([
        'period',
        'tz',
        'weekStart',
        'now',
        'generatedAt',
        'source',
        'missingPricingModels',
      ])
    );

    expect(Array.isArray(res.body.models)).toBe(true);
    expect(Object.keys(res.body.totals)).toEqual(
      expect.arrayContaining([
        'inputTokens',
        'outputTokens',
        'cacheReadTokens',
        'cacheWriteTokens',
        'totalTokens',
        'totalCost',
      ])
    );

    expect(res.body.models).toHaveLength(1);
    expect(res.body.models[0]).toMatchObject({
      provider: 'openai',
      model: 'gpt-5',
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
  });

  it('uses nested totals.cost.total when totals.cost is an object', async () => {
    pricing.repriceModelUsageRows = vi.fn((rows) => ({ rows, missingPricingModels: [] }));
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        rows: [
          {
            provider: 'openai',
            model: 'gpt-5',
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

    const res = await request(createApp()).get('/api/model-usage/live-weekly');

    expect(res.status).toBe(200);
    expect(res.body.models).toHaveLength(1);
    expect(res.body.models[0].totalCost).toBe(4.25);
    expect(res.body.totals.totalCost).toBe(4.25);
  });

  it('is null-safe when sessions.usage returns a null result payload', async () => {
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: null,
    });

    const res = await request(createApp()).get('/api/model-usage/live-weekly');

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

  it('ignores malformed rows and drops zero-token rows', async () => {
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        rows: [
          null,
          'bad-row',
          123,
          {
            provider: 'openai',
            model: 'gpt-5',
            totals: {
              input: 1,
              output: 2,
              totalTokens: 3,
            },
          },
          {
            provider: 'openai',
            model: 'gpt-5',
            totals: {
              input: 0,
              output: 0,
              totalTokens: 0,
            },
          },
        ],
      },
    });

    const res = await request(createApp()).get('/api/model-usage/live-weekly');

    expect(res.status).toBe(200);
    expect(res.body.models).toHaveLength(1);
    expect(res.body.models[0]).toMatchObject({
      provider: 'openai',
      model: 'gpt-5',
      totalTokens: 3,
    });
  });

  it('falls back totalTokens to input+output+cache tokens when totals.totalTokens is absent', async () => {
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        rows: [
          {
            provider: 'openai',
            model: 'gpt-5',
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

    const res = await request(createApp()).get('/api/model-usage/live-weekly');

    expect(res.status).toBe(200);
    expect(res.body.models[0].totalTokens).toBe(23);
    expect(res.body.totals.totalTokens).toBe(23);
  });

  it('forwards the live-week window computed by getLiveWeekWindow', async () => {
    const now = Date.parse('2026-02-23T14:20:00-06:00');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: { rows: [] },
    });

    await request(createApp()).get('/api/model-usage/live-weekly');

    const expected = getLiveWeekWindow(TEST_TZ, now);
    const args = usageRpc.requestSessionsUsage.mock.calls[0]?.[0];

    expect(usageRpc.requestSessionsUsage).toHaveBeenCalledTimes(1);
    expect(args).toEqual({
      from: expected.fromMs,
      to: expected.toMs,
      timezone: TEST_TZ,
    });
  });

  it('serves cached live-weekly response within TTL and keeps generatedAt stable', async () => {
    process.env.HUD_USAGE_CACHE_TTL_MS = '1000';
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(1_200);

    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        rows: [
          {
            provider: 'openai',
            model: 'gpt-5',
            totals: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, totalCost: 1 },
          },
        ],
      },
    });

    const app = createApp();
    const first = await request(app).get('/api/model-usage/live-weekly');
    const second = await request(app).get('/api/model-usage/live-weekly');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(usageRpc.requestSessionsUsage).toHaveBeenCalledTimes(1);
    expect(second.body.meta.generatedAt).toBe(first.body.meta.generatedAt);
  });

  it('refreshes cached live-weekly response after TTL expiry', async () => {
    process.env.HUD_USAGE_CACHE_TTL_MS = '1000';
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(2_000).mockReturnValueOnce(3_500);

    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        rows: [
          {
            provider: 'openai',
            model: 'gpt-5',
            totals: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, totalCost: 1 },
          },
        ],
      },
    });

    const app = createApp();
    const first = await request(app).get('/api/model-usage/live-weekly');
    const second = await request(app).get('/api/model-usage/live-weekly');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(usageRpc.requestSessionsUsage).toHaveBeenCalledTimes(2);
    expect(second.body.meta.generatedAt).not.toBe(first.body.meta.generatedAt);
  });

  it('refreshes cached live-weekly response when pricing fingerprint changes within TTL', async () => {
    process.env.HUD_USAGE_CACHE_TTL_MS = '1000';
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(5_000).mockReturnValueOnce(5_100);

    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        rows: [
          {
            provider: 'openai',
            model: 'gpt-5',
            totals: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, totalCost: 1 },
          },
        ],
      },
    });

    const app = createApp();
    const first = await request(app).get('/api/model-usage/live-weekly');
    pricing.getPricingConfigFingerprint.mockReturnValue('pricing-v2');
    const second = await request(app).get('/api/model-usage/live-weekly');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(usageRpc.requestSessionsUsage).toHaveBeenCalledTimes(2);
    expect(second.body.meta.generatedAt).not.toBe(first.body.meta.generatedAt);
  });

  it('bypasses cache when refresh=1 is provided', async () => {
    process.env.HUD_USAGE_CACHE_TTL_MS = '1000';
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(4_000).mockReturnValueOnce(4_100);

    usageRpc.requestSessionsUsage.mockResolvedValue({
      ok: true,
      result: {
        rows: [
          {
            provider: 'openai',
            model: 'gpt-5',
            totals: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, totalCost: 1 },
          },
        ],
      },
    });

    const app = createApp();
    const first = await request(app).get('/api/model-usage/live-weekly');
    const second = await request(app).get('/api/model-usage/live-weekly?refresh=1');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(usageRpc.requestSessionsUsage).toHaveBeenCalledTimes(2);
    expect(second.body.meta.generatedAt).not.toBe(first.body.meta.generatedAt);
  });
});
