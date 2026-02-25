const { test, expect } = require('@playwright/test');

function makeLiveWeeklyPayload({ model, inputTokens, outputTokens, cacheReadTokens, totalTokens, totalCost, agentTokens = 0 }) {
  return {
    meta: {
      period: 'live-weekly',
      tz: 'America/Chicago',
      weekStart: new Date(Date.UTC(2026, 1, 23)).toISOString(),
      now: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
      source: 'sessions.usage+config-reprice',
      missingPricingModels: [],
    },
    totals: {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens: 0,
      totalTokens,
      totalCost,
    },
    models: [
      {
        provider: 'anthropic',
        model,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens: 0,
        totalTokens,
        totalCost,
        agents: {
          'test-agent': {
            inputTokens: agentTokens || inputTokens,
            outputTokens: agentTokens || outputTokens,
            totalTokens,
          },
        },
      },
    ],
  };
}

function setupMockLiveWeeklyRoute(page, payloads) {
  const calls = [];

  page.route('**/api/model-usage/live-weekly*', (route) => {
    calls.push(route.request().url());
    const index = Math.min(calls.length - 1, payloads.length - 1);
    const payload = payloads[index];

    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });

  return {
    getCalls: () => calls.slice(),
  };
}

test.describe('Model usage (live-weekly contract)', () => {
  test('renders model usage panel from /api/model-usage/live-weekly with model/ tokens / cost fields', async ({ page }) => {
    const { getCalls } = setupMockLiveWeeklyRoute(page, [
      makeLiveWeeklyPayload({
        model: 'anthropic/claude-sonnet-4',
        inputTokens: 150,
        outputTokens: 30,
        cacheReadTokens: 40,
        totalTokens: 220,
        totalCost: 4.2,
      }),
    ]);

    await page.goto('/');

    const modelsPanel = page.locator('#p-models');
    const modelRows = modelsPanel.locator('.model-bar-row');
    const usageEndpointCalls = getCalls();

    await expect(modelsPanel.locator('#models-heading')).toContainText('MODEL USAGE');

    await expect(modelRows).toHaveCount(1);
    await expect(modelRows.first().locator('.model-bar-label')).toContainText('claude-sonnet-4');
    await expect(modelRows.first().locator('.model-bar-label')).toContainText('220 tokens');
    await expect(modelRows.first().locator('.token-breakdown')).toContainText('IN: 150');
    await expect(modelRows.first().locator('.token-breakdown')).toContainText('OUT: 30');
    await expect(modelRows.first().locator('.token-breakdown')).toContainText('CACHE: 40');
    await expect(modelRows.first().locator('.token-cost')).toContainText('$4.20');

    const callLog = usageEndpointCalls.map((url) => new URL(url).pathname);
    expect(callLog).toContain('/api/model-usage/live-weekly');
    expect(callLog).not.toContain('/api/model-usage');
  });

  test('updates rendered live-weekly values on a forced refresh cycle', async ({ page }) => {
    // Full manual refresh is not surfaced in the UI, and auto-polling is 15s.
    // To keep this test deterministic and fast, we assert refresh behavior by
    // triggering HUD.fetchAll() directly after load and stubbing two stable
    // payloads for consecutive /api/model-usage/live-weekly responses.
    const { getCalls } = setupMockLiveWeeklyRoute(page, [
      makeLiveWeeklyPayload({
        model: 'anthropic/claude-sonnet-4',
        inputTokens: 150,
        outputTokens: 30,
        cacheReadTokens: 40,
        totalTokens: 220,
        totalCost: 4.2,
      }),
      makeLiveWeeklyPayload({
        model: 'anthropic/claude-sonnet-4',
        inputTokens: 300,
        outputTokens: 90,
        cacheReadTokens: 20,
        totalTokens: 410,
        totalCost: 6.5,
      }),
    ]);

    await page.goto('/');

    const modelsPanel = page.locator('#p-models');
    const modelRows = modelsPanel.locator('.model-bar-row');

    await expect(modelRows).toHaveCount(1);
    await expect(modelRows.first().locator('.model-bar-label')).toContainText('220 tokens');

    // Force an immediate second fetch and verify UI reflects refreshed payload.
    await page.evaluate(() => window.HUD.fetchAll());

    await expect.poll(async () => {
      const latestCalls = getCalls();
      return latestCalls.length;
    }, { timeout: 5000, intervals: [100, 100, 200, 250, 500, 1000] }).toBeGreaterThanOrEqual(2);

    await expect(modelRows.first().locator('.model-bar-label')).toContainText('410 tokens');
    await expect(modelRows.first().locator('.token-breakdown')).toContainText('IN: 300');
    await expect(modelRows.first().locator('.token-cost')).toContainText('$6.50');
  });
});
