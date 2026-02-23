const { test, expect } = require('@playwright/test');

test.describe('CDN Local Fallback (D4.1)', () => {
  test('HUD loads successfully when CDN is blocked', async ({ browser }) => {
    // Create context with CDN domain blocked
    const context = await browser.newContext({
      // Block the CDN domains
      route: async (route, request) => {
        const url = request.url();
        if (url.includes('cdn.jsdelivr.net')) {
          await route.abort('connectionrefused');
        } else {
          await route.continue();
        }
      }
    });
    
    const page = await context.newPage();
    
    // Navigate to HUD
    await page.goto('/');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Verify HUD loaded by checking for key elements
    await expect(page.locator('.hud-header')).toBeVisible();
    await expect(page.locator('.logo-glitch')).toContainText('OPENCLAW');
    
    // Verify that the vendor libraries loaded from local fallback
    const markedLoaded = await page.evaluate(() => typeof window.marked !== 'undefined');
    const purifyLoaded = await page.evaluate(() => typeof window.DOMPurify !== 'undefined');
    
    expect(markedLoaded).toBe(true);
    expect(purifyLoaded).toBe(true);
    
    await context.close();
  });

  test('local vendor files are accessible', async ({ request }) => {
    // Test that local vendor files exist and are valid JS
    const marked = await request.get('/vendor/marked.min.js');
    expect(marked.status()).toBe(200);
    expect(await marked.text()).toContain('marked');
    
    const purify = await request.get('/vendor/purify.min.js');
    expect(purify.status()).toBe(200);
    expect(await purify.text()).toContain('purify');
  });
});
