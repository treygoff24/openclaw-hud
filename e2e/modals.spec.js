const { test, expect } = require('@playwright/test');

test.describe('Cron Modal', () => {
  test('click cron row → edit modal opens with fields populated', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.cron-row-v2');
    await page.locator('.cron-row-v2').first().click();
    await expect(page.locator('#cron-modal')).toHaveClass(/active/);
    await expect(page.locator('#cron-name')).toHaveValue('Morning Briefing');
    await expect(page.locator('#cron-enabled')).toBeChecked();
  });

  test('cancel closes cron modal', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.cron-row-v2');
    await page.locator('.cron-row-v2').first().click();
    await expect(page.locator('#cron-modal')).toHaveClass(/active/);
    await page.locator('#cron-modal .hud-btn-cancel').click();
    await expect(page.locator('#cron-modal')).not.toHaveClass(/active/);
  });

  test('Escape closes cron modal', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.cron-row-v2');
    await page.locator('.cron-row-v2').first().click();
    await expect(page.locator('#cron-modal')).toHaveClass(/active/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#cron-modal')).not.toHaveClass(/active/);
  });
});

test.describe('Spawn Modal', () => {
  test('click "+ NEW" → spawn modal opens', async ({ page }) => {
    await page.goto('/');
    await page.locator('#open-spawn-btn').click();
    await expect(page.locator('#spawn-modal')).toHaveClass(/active/);
  });

  test('empty prompt shows error', async ({ page }) => {
    await page.goto('/');
    await page.locator('#open-spawn-btn').click();
    await expect(page.locator('#spawn-modal')).toHaveClass(/active/);
    await page.locator('#spawn-launch-btn').click();
    await expect(page.locator('#spawn-error')).toBeVisible();
    await expect(page.locator('#spawn-error')).toContainText('required');
  });

  test('cancel closes spawn modal', async ({ page }) => {
    await page.goto('/');
    await page.locator('#open-spawn-btn').click();
    await expect(page.locator('#spawn-modal')).toHaveClass(/active/);
    await page.locator('#spawn-cancel-btn').click();
    await expect(page.locator('#spawn-modal')).not.toHaveClass(/active/);
  });
});

test.describe('Modal priority', () => {
  test('Escape closes modal first, then chat pane', async ({ page }) => {
    await page.goto('/');
    // Open chat pane by clicking a session node
    await page.waitForSelector('.tree-node-content[data-session]');
    await page.locator('.tree-node-content[data-session]').first().click();
    await expect(page.locator('.hud-layout')).toHaveClass(/chat-open/);

    // Open spawn modal
    await page.locator('#open-spawn-btn').click();
    await expect(page.locator('#spawn-modal')).toHaveClass(/active/);

    // First Escape closes modal, chat stays
    await page.keyboard.press('Escape');
    await expect(page.locator('#spawn-modal')).not.toHaveClass(/active/);
    await expect(page.locator('.hud-layout')).toHaveClass(/chat-open/);

    // Second Escape closes chat pane
    await page.keyboard.press('Escape');
    await expect(page.locator('.hud-layout')).not.toHaveClass(/chat-open/);
  });
});
