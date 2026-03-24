const { test, expect } = require("@playwright/test");

test.describe("Chat diagnostics and degraded behavior", () => {
  test("gateway disconnect banner appears and clears on reconnect", async ({ page }) => {
    await page.goto("/");

    await page.evaluate(() => {
      window.handleChatWsMessage({ type: "gateway-status", status: "connected" });
    });
    await expect(page.locator("#gateway-banner")).toBeHidden();

    await page.evaluate(() => {
      window.handleChatWsMessage({ type: "gateway-status", status: "disconnected" });
    });

    await expect(page.locator("#gateway-banner")).toBeVisible();
    await expect(page.locator("#gateway-banner")).toContainText("Gateway connection lost");

    await page.evaluate(() => {
      window.handleChatWsMessage({ type: "gateway-status", status: "connected" });
    });

    await expect(page.locator("#gateway-banner")).toBeHidden();
  });

  test("send failure surfaces explicit retry action without gateway response", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".tree-node-content[data-session='sess-abc-001']");
    await page.locator(".tree-node-content[data-session='sess-abc-001']").first().click();

    await expect(page.locator(".chat-open")).toBeVisible();
    await page.locator("#chat-input").fill("simulate fail-fast diagnostics");
    await page.locator("#chat-send-btn").click();

    const failedMessage = page.locator("#chat-messages .chat-msg.failed");
    await expect(failedMessage).toBeVisible();
    await expect(failedMessage).toContainText("simulate fail-fast diagnostics");
    await expect(failedMessage.locator(".retry-btn")).toBeVisible();
    await expect(page.locator("#chat-input")).toBeEnabled();
  });
});
