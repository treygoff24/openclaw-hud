import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const usageRpc = require('../../lib/usage-rpc');
const pricing = require('../../lib/pricing');
const { getLiveWeekWindow } = await import('../../lib/helpers.js');

const originalRequestSessionsUsage = usageRpc.requestSessionsUsage;
const originalLoadPricingCatalog = pricing.loadPricingCatalog;
const TEST_TZ = 'America/Chicago';
const originalUsageTz = process.env.HUD_USAGE_TZ;

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
  });

  afterEach(() => {
    usageRpc.requestSessionsUsage = originalRequestSessionsUsage;
    pricing.loadPricingCatalog = originalLoadPricingCatalog;
    process.env.HUD_USAGE_TZ = originalUsageTz;
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
});
