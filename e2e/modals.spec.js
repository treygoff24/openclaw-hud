const { test, expect } = require("@playwright/test");

test.describe("Cron Modal", () => {
  test("click cron row → edit modal opens with fields populated", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".cron-row-v2");
    await page.locator(".cron-row-v2").first().click();
    await expect(page.locator("#cron-modal")).toHaveClass(/active/);
    await expect(page.locator("#cron-name")).toHaveValue("Morning Briefing");
    await expect(page.locator("#cron-enabled")).toBeChecked();
  });

  test("cancel closes cron modal", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".cron-row-v2");
    await page.locator(".cron-row-v2").first().click();
    await expect(page.locator("#cron-modal")).toHaveClass(/active/);
    await page.locator("#cron-modal .hud-btn-cancel").click();
    await expect(page.locator("#cron-modal")).not.toHaveClass(/active/);
  });

  test("save sends PUT request with updated fields", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".cron-row-v2");

    // Intercept the PUT request
    const putPromise = page.waitForRequest(
      (req) => req.method() === "PUT" && req.url().includes("/api/cron/morning-check"),
    );
    await page.route("**/api/cron/morning-check", async (route) => {
      const req = route.request();
      if (req.method() === "PUT") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, job: {} }),
        });
      } else {
        await route.continue();
      }
    });

    await page.locator(".cron-row-v2").first().click();
    await expect(page.locator("#cron-modal")).toHaveClass(/active/);
    await page.locator("#cron-name").fill("Updated Briefing");
    await page.locator(".hud-btn-save").click();

    const req = await putPromise;
    const body = req.postDataJSON();
    expect(body.name).toBe("Updated Briefing");
    await expect(page.locator("#cron-modal")).not.toHaveClass(/active/);
  });

  test("Escape closes cron modal", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".cron-row-v2");
    await page.locator(".cron-row-v2").first().click();
    await expect(page.locator("#cron-modal")).toHaveClass(/active/);
    await page.keyboard.press("Escape");
    await expect(page.locator("#cron-modal")).not.toHaveClass(/active/);
  });
});

test.describe("Spawn Modal", () => {
  test("all spawn form fields present", async ({ page }) => {
    await page.goto("/");
    await page.locator("#open-spawn-btn").click();
    await expect(page.locator("#spawn-agent")).toBeVisible();
    await expect(page.locator("#spawn-model")).toBeVisible();
    await expect(page.locator("#spawn-label")).toBeVisible();
    await expect(page.locator("#spawn-mode")).toHaveCount(0);
    await expect(page.locator("#spawn-timeout")).toBeVisible();
    await expect(page.locator("#spawn-files")).toBeVisible();
    await expect(page.locator("#spawn-prompt")).toBeVisible();
  });

  test('click "+ NEW" → spawn modal opens', async ({ page }) => {
    await page.goto("/");
    await page.locator("#open-spawn-btn").click();
    await expect(page.locator("#spawn-modal")).toHaveClass(/active/);
  });

  test("empty prompt shows error", async ({ page }) => {
    await page.goto("/");
    await page.locator("#open-spawn-btn").click();
    await expect(page.locator("#spawn-modal")).toHaveClass(/active/);
    await page.locator("#spawn-launch-btn").click();
    await expect(page.locator("#spawn-error")).toBeVisible();
    await expect(page.locator("#spawn-error")).toContainText("required");
  });

  test("cancel closes spawn modal", async ({ page }) => {
    await page.goto("/");
    await page.locator("#open-spawn-btn").click();
    await expect(page.locator("#spawn-modal")).toHaveClass(/active/);
    await page.locator("#spawn-cancel-btn").click();
    await expect(page.locator("#spawn-modal")).not.toHaveClass(/active/);
  });
});

test.describe("Modal priority", () => {
  test("Escape closes modal first, then chat pane", async ({ page }) => {
    await page.goto("/");
    // Open chat pane by clicking a session node
    await page.waitForSelector(".tree-node-content[data-session]");
    await page.locator(".tree-node-content[data-session]").first().click();
    await expect(page.locator(".hud-layout")).toHaveClass(/chat-open/);

    // Open spawn modal
    await page.locator("#open-spawn-btn").click();
    await expect(page.locator("#spawn-modal")).toHaveClass(/active/);

    // First Escape closes modal, chat stays
    await page.keyboard.press("Escape");
    await expect(page.locator("#spawn-modal")).not.toHaveClass(/active/);
    await expect(page.locator(".hud-layout")).toHaveClass(/chat-open/);

    // Second Escape closes chat pane
    await page.keyboard.press("Escape");
    await expect(page.locator(".hud-layout")).not.toHaveClass(/chat-open/);
  });
});
