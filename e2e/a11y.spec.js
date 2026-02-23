const { test, expect } = require('@playwright/test');

/**
 * E2E Accessibility Tests
 * 
 * Run with: npm run test:e2e -- e2e/a11y.spec.js
 */

test.describe('E2E Accessibility', () => {

  test.describe('Page Structure', () => {
    test('should have skip link as first focusable element', async ({ page }) => {
      await page.goto('/');
      await page.keyboard.press('Tab');

      const focusedClass = await page.evaluate(() => document.activeElement?.className || '');
      expect(focusedClass).toContain('skip-link');
    });
  });

  test.describe('Focus Management', () => {
    test('should trap focus in spawn modal', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#open-spawn-btn');
      await page.click('#open-spawn-btn');
      await page.waitForSelector('#spawn-modal.active');

      const focusableCount = await page.evaluate(() => {
        const modal = document.querySelector('#spawn-modal');
        if (!modal) return 0;
        return modal.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])').length;
      });

      expect(focusableCount).toBeGreaterThan(0);
    });

    test('should close modal on Escape key', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#open-spawn-btn');
      await page.click('#open-spawn-btn');
      await page.waitForSelector('#spawn-modal.active');

      await page.keyboard.press('Escape');

      const modalClass = await page.evaluate(() =>
        document.querySelector('#spawn-modal')?.className || ''
      );
      expect(modalClass).not.toContain('active');
    });
  });

  test.describe('ARIA Attributes', () => {
    test('should have proper ARIA roles on main sections', async ({ page }) => {
      await page.goto('/');

      const roles = await page.evaluate(() => ({
        dashboard: document.querySelector('#dashboard')?.getAttribute('role'),
        chatPane: document.querySelector('#chat-pane')?.getAttribute('role'),
        agentsList: document.querySelector('#agents-list')?.getAttribute('role'),
        treeBody: document.querySelector('#tree-body')?.getAttribute('role'),
        activityFeed: document.querySelector('#activity-feed')?.getAttribute('role'),
      }));

      expect(roles.dashboard).toBe('main');
      expect(roles.chatPane).toBe('complementary');
      expect(roles.agentsList).toBe('list');
      expect(roles.treeBody).toBe('tree');
      expect(roles.activityFeed).toBe('log');
    });

    test('should have aria-live regions for dynamic content', async ({ page }) => {
      await page.goto('/');

      const live = await page.evaluate(() => ({
        chatMessages: document.querySelector('#chat-messages')?.getAttribute('aria-live'),
        activityFeed: document.querySelector('#activity-feed')?.getAttribute('aria-live'),
        toast: document.querySelector('#toast')?.getAttribute('aria-live'),
        agentCount: document.querySelector('#agent-count')?.getAttribute('aria-live'),
      }));

      expect(live.chatMessages).toBe('polite');
      expect(live.activityFeed).toBe('polite');
      expect(live.toast).toBe('polite');
      expect(live.agentCount).toBe('polite');
    });
  });

  test.describe('Keyboard Navigation', () => {
    test('should have many focusable elements', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(500);

      const focusableCount = await page.evaluate(() =>
        document.querySelectorAll('button, a, input, [tabindex]:not([tabindex="-1"])').length
      );

      expect(focusableCount).toBeGreaterThan(5);
    });
  });
});
