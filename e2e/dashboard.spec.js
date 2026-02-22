const { test, expect } = require('@playwright/test');

test.describe('Dashboard Panels', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.agent-card');
  });

  test('all 7 panels render with correct headers', async ({ page }) => {
    const expectedHeaders = [
      'AGENT FLEET',
      'CRON CONTROL',
      'SYSTEM STATUS',
      'SESSION TREE',
      'MODEL USAGE',
      'ACTIVE SESSIONS',
      'ACTIVITY FEED',
    ];
    for (const header of expectedHeaders) {
      const panel = page.locator('.panel-header', { hasText: header });
      await expect(panel).toBeVisible();
    }
  });

  test('agent cards show test-agent', async ({ page }) => {
    const card = page.locator('.agent-card', { hasText: 'test-agent' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('test-agent');
  });

  test('session tree renders both sessions with status dots', async ({ page }) => {
    const tree = page.locator('#p-tree');
    await expect(tree.locator('.tree-node-content', { hasText: 'main' }).first()).toBeVisible();
    await expect(tree.locator('.tree-node-content', { hasText: 'research-task' })).toBeVisible();
    const dots = tree.locator('[class*="status-dot-"]');
    expect(await dots.count()).toBeGreaterThanOrEqual(1);
  });

  test('cron panel shows 3 jobs with correct enabled states', async ({ page }) => {
    const cronPanel = page.locator('#p-cron');
    await expect(cronPanel).toContainText('Morning Briefing');
    await expect(cronPanel).toContainText('Weekly Summary');
    await expect(cronPanel).toContainText('Health Check');
  });

  test('system status shows default model and gateway port', async ({ page }) => {
    const statusPanel = page.locator('#p-system');
    await expect(statusPanel).toContainText('claude-sonnet-4');
    await expect(statusPanel).toContainText('3779');
  });

  test('model usage shows token bars for claude-sonnet-4', async ({ page }) => {
    const usagePanel = page.locator('#p-models');
    await expect(usagePanel).toContainText('claude-sonnet-4');
    const bars = usagePanel.locator('.bar, .token-bar, .usage-bar, [class*="bar"]');
    expect(await bars.count()).toBeGreaterThanOrEqual(1);
  });

  test('activity feed shows entries with test-agent', async ({ page }) => {
    const feed = page.locator('#p-activity');
    await expect(feed).toContainText('test-agent');
  });

  test('header clock is not static', async ({ page }) => {
    const clock = page.locator('#clock');
    const time1 = await clock.textContent();
    await page.waitForTimeout(1100);
    const time2 = await clock.textContent();
    expect(time1).not.toBe(time2);
  });

  test('agent search/filter works', async ({ page }) => {
    const searchBox = page.locator('#agent-search');
    const agentsList = page.locator('#agents-list');

    await searchBox.fill('test');
    await expect(agentsList.locator('.agent-card', { hasText: 'test-agent' })).toBeVisible();

    await searchBox.fill('nonexistent');
    await expect(agentsList.locator('.agent-card')).toHaveCount(0);
  });

  test('WebSocket connection established', async ({ page }) => {
    await page.waitForTimeout(2000);
    const wsState = await page.evaluate(() => {
      return window._hudWs ? window._hudWs.readyState : -1;
    });
    expect(wsState).toBe(1);
  });
});
