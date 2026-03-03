const { test, expect } = require("@playwright/test");

const cronFixtureResponse = {
  jobs: [
    {
      id: "morning-check",
      name: "Morning Briefing",
      enabled: true,
      agentId: "test-agent",
      sessionTarget: "main",
      schedule: { kind: "cron", expr: "0 8 * * *", tz: "America/Chicago" },
      payload: {
        kind: "systemEvent",
        text: "Give me a daily briefing.",
      },
      state: {
        lastStatus: "completed",
        lastRunAtMs: 1700000000000,
      },
    },
    {
      id: "weekly-report",
      name: "Weekly Summary",
      enabled: false,
      agentId: "test-agent",
      sessionTarget: "isolated",
      schedule: { kind: "cron", expr: "0 17 * * 5", tz: "America/Chicago" },
      payload: {
        kind: "systemEvent",
        text: "Prepare weekly summary.",
      },
      state: {
        lastStatus: "skipped",
      },
    },
  ],
  meta: {
    gatewayAvailable: true,
    diagnostics: [],
    source: "fixture",
  },
  total: 2,
  offset: 0,
  limit: 50,
  hasMore: false,
  nextOffset: null,
};

const spawnPreflightOkResponse = {
  ok: true,
  enabled: true,
  code: "READY",
  status: "ready",
  reason: null,
  diagnostics: [],
};

const spawnPreflightBlockedResponse = {
  ok: false,
  enabled: false,
  code: "SPAWN_PRECHECK_FAILED",
  status: "blocked",
  reason: "Spawn setup gate check failed.",
  checkedAt: 1700000000000,
  source: "e2e-failfast",
  diagnostics: [
    {
      code: "SPAWN_PRECHECK_BLOCKED",
      message: "Spawn setup requires allowlist/denylist override configuration.",
    },
  ],
};

test.describe("Cron Modal", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/cron", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(cronFixtureResponse),
      });
    });
  });

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
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/spawn-preflight", async (route) => {
      if (route.request().method() !== "GET") return route.continue();

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(spawnPreflightOkResponse),
      });
    });
  });

  test("all spawn form fields present", async ({ page }) => {
    await page.goto("/");
    await page.locator("#open-spawn-btn").click();
    await expect(page.locator("#spawn-agent")).toBeVisible();
    await expect(page.locator("#spawn-model")).toBeVisible();
    await expect(page.locator("#spawn-label")).toBeVisible();
    await expect(page.locator("#spawn-mode")).toBeVisible();
    await expect(page.locator("#spawn-timeout")).toBeVisible();
    await expect(page.locator("#spawn-files")).toBeVisible();
    await expect(page.locator("#spawn-prompt")).toBeVisible();
  });

  test('click "+ NEW" → spawn modal opens', async ({ page }) => {
    await page.goto("/");
    await page.locator("#open-spawn-btn").click();
    await expect(page.locator("#spawn-modal")).toHaveClass(/active/);
  });

  test("preflight failure disables spawn UI and surfaces diagnostic", async ({ page }) => {
    await page.route("**/api/spawn-preflight", async (route) => {
      if (route.request().method() !== "GET") return route.continue();

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(spawnPreflightBlockedResponse),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const openSpawn = page.locator("#open-spawn-btn");
    await expect(openSpawn).toBeDisabled();

    await page.evaluate(() => {
      window.HUD.spawn.open();
    });

    await expect(page.locator("#spawn-error")).toContainText(
      "Spawn setup requires allowlist/denylist override configuration.",
    );
    const openSpawnErrorDisplay = await page.locator("#spawn-error").evaluate((el) => el.style.display);
    expect(openSpawnErrorDisplay).toBe("block");
    await expect(page.locator("#spawn-modal")).not.toHaveClass(/active/);
  });

  test("empty prompt shows error", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator("#open-spawn-btn").click();
    await expect(page.locator("#spawn-modal")).toHaveClass(/active/);
    await page.locator("#spawn-launch-btn").click();
    await expect(page.locator("#spawn-error")).toContainText("required");
    const promptErrorDisplay = await page.locator("#spawn-error").evaluate((el) => el.style.display);
    expect(promptErrorDisplay).toBe("block");
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
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/spawn-preflight", async (route) => {
      if (route.request().method() !== "GET") return route.continue();

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(spawnPreflightOkResponse),
      });
    });
  });

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
