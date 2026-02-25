const { defineConfig } = require("@playwright/test");
const path = require("path");

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 1,
  globalSetup: "./e2e/fixtures/generate-timestamps.js",
  use: {
    baseURL: "http://localhost:3779",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "PORT=3779 node server.js",
    port: 3779,
    reuseExistingServer: false,
    env: {
      OPENCLAW_HOME: path.join(__dirname, "e2e", "fixtures", "openclaw-home"),
    },
  },
});
