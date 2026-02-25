const { test, expect } = require("@playwright/test");

test("homepage loads and shows OPENCLAW header", async ({ page }) => {
  await page.goto("/");
  const logo = page.locator(".logo-glitch");
  await expect(logo).toBeVisible();
  await expect(logo).toHaveText("OPENCLAW");
});
