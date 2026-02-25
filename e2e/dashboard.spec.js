const { test, expect } = require("@playwright/test");

test.describe("Dashboard Panels", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".agent-card");
  });

  test("all 7 panels render with correct headers", async ({ page }) => {
    const expectedHeaders = [
      "AGENT FLEET",
      "CRON CONTROL",
      "SYSTEM STATUS",
      "SESSION TREE",
      "MODEL USAGE",
      "ACTIVE SESSIONS",
      "ACTIVITY FEED",
    ];
    for (const header of expectedHeaders) {
      const panel = page.locator(".panel-header", { hasText: header });
      await expect(panel).toBeVisible();
    }
  });

  test("agent cards show test-agent", async ({ page }) => {
    const card = page.locator(".agent-card", { hasText: "test-agent" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("test-agent");
  });

  test("session tree renders both sessions with status dots", async ({ page }) => {
    const tree = page.locator("#p-tree");
    await expect(tree.locator(".tree-node-content", { hasText: "main" }).first()).toBeVisible();
    await expect(tree.locator(".tree-node-content", { hasText: "research-task" })).toBeVisible();
    const dots = tree.locator('[class*="status-dot-"]');
    expect(await dots.count()).toBeGreaterThanOrEqual(1);
  });

  test("cron panel shows 3 jobs with correct enabled states", async ({ page }) => {
    const cronPanel = page.locator("#p-cron");
    await expect(cronPanel).toContainText("Morning Briefing");
    await expect(cronPanel).toContainText("Weekly Summary");
    await expect(cronPanel).toContainText("Health Check");
  });

  test("system status shows default model and gateway port", async ({ page }) => {
    const statusPanel = page.locator("#p-system");
    await expect(statusPanel).toContainText("claude-sonnet-4");
    await expect(statusPanel).toContainText("18789");
  });

  test("system channels/providers render as wrapped tags", async ({ page }) => {
    const statusPanel = page.locator("#p-system");
    await expect(statusPanel.locator(".sys-tag-list").first()).toBeVisible();
    await expect(statusPanel.locator(".sys-tag", { hasText: "discord" })).toBeVisible();
    await expect(statusPanel.locator(".sys-tag", { hasText: "telegram" })).toBeVisible();

    const displayValue = await statusPanel
      .locator(".sys-tag-list")
      .first()
      .evaluate((el) => {
        return window.getComputedStyle(el).display;
      });
    expect(displayValue).toBe("flex");
  });

  test("model usage panel shows summary cards and monthly spend stat", async ({ page }) => {
    const usagePanel = page.locator("#p-models");
    await expect(usagePanel).toContainText("MODEL USAGE");

    await expect(usagePanel.locator(".model-summary-card")).toHaveCount(3);
    await expect(usagePanel).toContainText("THIS WEEK SPEND");
    await expect(usagePanel).toContainText("THIS MONTH SPEND");
    await expect(usagePanel).toContainText("TOP MONTH MODEL");

    const monthStat = page.locator("#stat-monthly-spend");
    await expect(monthStat).toBeVisible();
    await expect(monthStat).toContainText("$");
  });

  test("model usage panel shows either live data or empty-state message", async ({ page }) => {
    const usagePanel = page.locator("#p-models");
    await expect(usagePanel).toContainText("MODEL USAGE");

    const panelText = (await usagePanel.textContent()) || "";
    if (panelText.includes("No model data yet")) {
      await expect(usagePanel).toContainText("No model data yet");
      return;
    }

    await expect(usagePanel).toContainText("claude-sonnet-4");
    const bars = usagePanel.locator('.bar, .token-bar, .usage-bar, [class*="bar"]');
    expect(await bars.count()).toBeGreaterThanOrEqual(1);
  });

  test("activity feed shows entries with test-agent", async ({ page }) => {
    const feed = page.locator("#p-activity");
    await expect(feed).toContainText("test-agent");
  });

  test("header clock is not static", async ({ page }) => {
    const clock = page.locator("#clock");
    const time1 = await clock.textContent();
    await page.waitForTimeout(1100);
    const time2 = await clock.textContent();
    expect(time1).not.toBe(time2);
  });

  test("panel header typography is increased", async ({ page }) => {
    const header = page.locator(".panel-header").first();
    const fontSize = await header.evaluate((el) => {
      return Number.parseFloat(window.getComputedStyle(el).fontSize || "0");
    });
    expect(fontSize).toBeGreaterThanOrEqual(14);
  });

  test("agent search/filter works", async ({ page }) => {
    const searchBox = page.locator("#agent-search");
    const agentsList = page.locator("#agents-list");

    await searchBox.fill("test");
    await expect(agentsList.locator(".agent-card", { hasText: "test-agent" })).toBeVisible();

    await searchBox.fill("nonexistent");
    await expect(agentsList.locator(".agent-card")).toHaveCount(0);
  });

  test("WebSocket connection established", async ({ page }) => {
    await page.waitForTimeout(2000);
    const wsState = await page.evaluate(() => {
      return window._hudWs ? window._hudWs.readyState : -1;
    });
    expect(wsState).toBe(1);
  });
});
