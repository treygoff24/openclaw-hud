const { test, expect } = require("@playwright/test");

const cronFixture = {
  jobs: [
    {
      id: "morning-check",
      name: "Morning Briefing",
      enabled: true,
      agentId: "test-agent",
      sessionTarget: "main",
      schedule: { kind: "cron", expr: "0 8 * * *", tz: "America/Chicago" },
      payload: { kind: "systemEvent", text: "Good morning! Give me a daily briefing." },
      state: { lastStatus: "completed", lastRunAtMs: 1700000000000 },
    },
    {
      id: "weekly-report",
      name: "Weekly Summary",
      enabled: false,
      agentId: "test-agent",
      sessionTarget: "isolated",
      schedule: { kind: "cron", expr: "0 17 * * 5", tz: "America/Chicago" },
      payload: {
        kind: "agentTurn",
        message: "Generate a weekly summary report.",
        model: "anthropic/claude-sonnet-4",
        timeoutSeconds: 300,
      },
      state: { lastStatus: "skipped" },
    },
    {
      id: "health-ping",
      name: "Health Check",
      enabled: true,
      agentId: "test-agent",
      sessionTarget: "main",
      schedule: { kind: "cron", expr: "*/30 * * * *", tz: "America/Chicago" },
      payload: { kind: "systemEvent", text: "Run a health check on all services." },
      state: { lastStatus: "completed", lastRunAtMs: 1700000000000 },
    },
  ],
};

const cronFixtureResponse = {
  jobs: cronFixture.jobs,
  meta: {
    gatewayAvailable: true,
    diagnostics: [],
    source: "fixture",
  },
  total: 3,
  offset: 0,
  limit: 50,
  hasMore: false,
  nextOffset: null,
};

test.describe("Cron CRUD Contract", () => {
  test("renders fixture cron jobs with deterministic IDs", async ({ page }) => {
    await page.route("**/api/cron", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(cronFixtureResponse),
      });
    });

    await page.goto("/");
    await page.waitForSelector(".cron-row-v2");

    await expect(page.locator('.cron-row-v2[data-cron-id="morning-check"]')).toHaveCount(1);
    await expect(page.locator('.cron-row-v2[data-cron-id="weekly-report"]')).toHaveCount(1);
    await expect(page.locator('.cron-row-v2[data-cron-id="health-ping"]')).toHaveCount(1);

    const rows = page.locator(".cron-row-v2");
    await expect(rows).toHaveCount(3);

    await expect(
      page.locator('.cron-row-v2[data-cron-id="morning-check"] .cron-name'),
    ).toContainText("Morning Briefing");
    await expect(
      page.locator('.cron-row-v2[data-cron-id="weekly-report"] .cron-name'),
    ).toContainText("Weekly Summary");
    await expect(page.locator('.cron-row-v2[data-cron-id="health-ping"] .cron-name')).toContainText(
      "Health Check",
    );
  });

  test("updating a cron job sends deterministic payload", async ({ page }) => {
    await page.route("**/api/cron", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(cronFixtureResponse),
      });
    });

    await page.route("**/api/cron/morning-check", async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, job: {} }),
        });
        return;
      }
      return route.continue();
    });

    const requestPromise = page.waitForRequest(
      (req) => req.method() === "PUT" && req.url().includes("/api/cron/morning-check"),
    );

    await page.goto("/");
    await page.waitForSelector('.cron-row-v2[data-cron-id="morning-check"]');

    await page.locator('.cron-row-v2[data-cron-id="morning-check"]').click();
    await expect(page.locator("#cron-modal")).toHaveClass(/active/);

    await page.locator("#cron-name").fill("Morning Briefing (Automated)");
    await page.locator("#cron-prompt").fill("Updated fixture payload for e2e contract checks.");
    await page.locator(".hud-btn-save").click();

    const request = await requestPromise;
    const body = request.postDataJSON();
    expect(body.name).toBe("Morning Briefing (Automated)");
    expect(body.enabled).toBe(true);
    expect(body.payload.text).toBe("Updated fixture payload for e2e contract checks.");
    expect(body.id).toBe("morning-check");

    await expect(page.locator("#cron-modal")).not.toHaveClass(/active/);
  });

  test("displays cron degraded banner when API response is explicit fallback", async ({ page }) => {
    await page.route("**/api/cron", async (route) => {
      if (route.request().method() !== "GET") {
        return route.continue();
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
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
                text: "Degraded fixture payload",
              },
              state: {
                lastStatus: "completed",
                lastRunAtMs: 1700000000000,
              },
            },
          ],
          meta: {
            gatewayAvailable: false,
            diagnostics: [
              {
                code: "CRON_LIST_FALLBACK",
                message: "Cron list gateway RPC unavailable.",
              },
            ],
          },
          total: 1,
          offset: 0,
          limit: 50,
          hasMore: false,
          nextOffset: null,
        }),
      });
    });

    await page.goto("/");
    await page.waitForSelector(".cron-degraded-banner");

    const banner = page.locator(".cron-degraded-banner");
    await expect(banner).toContainText("Gateway list fallback");
    await expect(banner).toContainText("Cron list gateway RPC unavailable.");
  });
});
