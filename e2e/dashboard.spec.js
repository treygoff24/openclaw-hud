const { test, expect } = require('@playwright/test');

test.describe('Dashboard HUD', () => {
  test('all 7 panels render with correct headers', async ({ page }) => {
    await page.goto('/');
    const panels = {
      '#p-agents': 'AGENT FLEET',
      '#p-cron': 'CRON CONTROL',
      '#p-system': 'SYSTEM STATUS',
      '#p-tree': 'SESSION TREE',
      '#p-models': 'MODEL USAGE',
      '#p-sessions': 'ACTIVE SESSIONS',
      '#p-activity': 'ACTIVITY FEED',
    };
    for (const [id, header] of Object.entries(panels)) {
      const panel = page.locator(id);
      await expect(panel).toBeVisible();
      await expect(panel.locator('.panel-header')).toContainText(header);
    }
  });

  test('agent cards show from fixture data', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.agent-card');
    const card = page.locator('#agents-list .agent-card');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('test-agent');
  });

  test('session tree renders with sessions and status dots', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.tree-node');
    const nodes = page.locator('#tree-body .tree-node');
    await expect(nodes).not.toHaveCount(0);
    const dots = page.locator('#tree-body [class*="status-dot"]');
    await expect(dots).not.toHaveCount(0);
  });

  test('cron panel shows enabled/disabled jobs', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.cron-row-v2');
    const rows = page.locator('#cron-list .cron-row-v2');
    await expect(rows).toHaveCount(3);
    await expect(page.locator('#cron-list')).toContainText('Morning Briefing');
    await expect(page.locator('#cron-list')).toContainText('Weekly Summary');
  });

  test('system status shows config values', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#system-info');
    const info = page.locator('#system-info');
    await expect(info).toContainText('anthropic/claude-sonnet-4');
    await expect(info).toContainText('3779');
  });

  test('agent search/filter works', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.agent-card');
    await page.fill('#agent-search', 'nonexistent');
    await expect(page.locator('#agents-list .agent-card')).toHaveCount(0);
    await page.fill('#agent-search', '');
    await expect(page.locator('#agents-list .agent-card')).not.toHaveCount(0);
  });

  test('header clock is not static', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#clock');
    // Wait for clock to have content
    await expect(page.locator('#clock')).not.toHaveText('');
    const time1 = await page.locator('#clock').textContent();
    await page.waitForTimeout(2000);
    const time2 = await page.locator('#clock').textContent();
    expect(time1).not.toBe(time2);
  });
});
