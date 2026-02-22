const { test, expect } = require('@playwright/test');

test.describe('Chat Pane', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.tree-node-content');
  });

  async function openSession(page, sessionId) {
    await page.locator(`.tree-node-content[data-session="${sessionId}"]`).first().click();
    await page.waitForSelector('.chat-open');
  }

  test('click session in tree opens chat pane', async ({ page }) => {
    await openSession(page, 'sess-abc-001');
    await expect(page.locator('.hud-layout')).toHaveClass(/chat-open/);
  });

  test('chat pane header shows agent ID and session info', async ({ page }) => {
    await openSession(page, 'sess-abc-001');
    await expect(page.locator('#chat-title')).toContainText('test-agent');
  });

  test('message area displays messages from fixture', async ({ page }) => {
    await openSession(page, 'sess-abc-001');
    await page.waitForSelector('.chat-msg');
    const msgs = page.locator('.chat-msg');
    await expect(msgs).not.toHaveCount(0);
    await expect(page.locator('#chat-messages')).toContainText('Hello, can you help me');
  });

  test('close button closes pane', async ({ page }) => {
    await openSession(page, 'sess-abc-001');
    await page.click('#chat-close');
    await expect(page.locator('.hud-layout')).not.toHaveClass(/chat-open/);
  });

  test('escape closes pane when no modal open', async ({ page }) => {
    await openSession(page, 'sess-abc-001');
    await page.keyboard.press('Escape');
    await expect(page.locator('.hud-layout')).not.toHaveClass(/chat-open/);
  });

  test('click different session swaps content', async ({ page }) => {
    await openSession(page, 'sess-abc-001');
    await page.waitForSelector('.chat-msg');
    await expect(page.locator('#chat-title')).toContainText('main');

    await openSession(page, 'sess-abc-002');
    await expect(page.locator('#chat-title')).toContainText('research-task');
    await page.waitForSelector('.chat-msg');
    await expect(page.locator('#chat-messages')).toContainText('quantum computing');
  });

  test('auto-scroll: messages area scrolled to bottom on open', async ({ page }) => {
    await openSession(page, 'sess-abc-001');
    await page.waitForSelector('.chat-msg');
    const isNearBottom = await page.evaluate(() => {
      const el = document.getElementById('chat-messages');
      return (el.scrollHeight - el.scrollTop - el.clientHeight) < 100;
    });
    expect(isNearBottom).toBe(true);
  });

  test('localStorage persistence across reload', async ({ page }) => {
    await openSession(page, 'sess-abc-001');
    await page.reload();
    await expect(page.locator('.hud-layout')).toHaveClass(/chat-open/);
  });
});
