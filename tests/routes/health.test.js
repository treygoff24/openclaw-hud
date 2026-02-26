import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";

const originalDateNow = Date.now;
const mockStartTime = 1700000000000;
let tmpOpenclawHome;

function createApp(options = {}) {
  delete require.cache[require.resolve("../../routes/health")];
  const router = require("../../routes/health");
  router.setHealthStateProvider(options.healthStateProvider || null);
  const app = express();
  app.use(router);
  return app;
}

describe("GET /health", () => {
  beforeEach(() => {
    tmpOpenclawHome = fs.mkdtempSync(path.join(os.tmpdir(), "health-route-"));
    process.env.OPENCLAW_HOME = tmpOpenclawHome;
    Date.now = vi.fn().mockReturnValue(mockStartTime + 3600000);
  });

  afterEach(() => {
    Date.now = originalDateNow;
    delete process.env.OPENCLAW_HOME;
    if (tmpOpenclawHome) {
      fs.rmSync(tmpOpenclawHome, { recursive: true, force: true });
      tmpOpenclawHome = null;
    }
  });

  it("returns healthy status with required fields by default", async () => {
    const res = await request(createApp()).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "healthy");
    expect(res.body).toHaveProperty("version");
    expect(res.body).toHaveProperty("uptime");
    expect(res.body).toHaveProperty("checks");
    expect(res.body.checks).toEqual({
      websocket: "unknown",
      filesystem: "writable",
    });
  });

  it("does not write or delete probe files", async () => {
    const probePath = path.join(tmpOpenclawHome, ".health-check-test");
    await request(createApp()).get("/health");
    expect(fs.existsSync(probePath)).toBe(false);
  });

  it("returns degraded when filesystem is not writable", async () => {
    process.env.OPENCLAW_HOME = path.join(tmpOpenclawHome, "missing-dir");
    const res = await request(createApp()).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks.filesystem).toBe("unwritable");
  });

  it("reports websocket state from runtime provider truthfully", async () => {
    const res = await request(
      createApp({
        healthStateProvider: () => ({ gatewayConnected: false, websocketClients: 2 }),
      }),
    ).get("/health");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks.websocket).toBe("disconnected");
    expect(res.body.checks.websocketClients).toBe(2);
  });

  it("returns correct version from package.json", async () => {
    const res = await request(createApp()).get("/health");
    const packageJson = require("../../package.json");
    expect(res.body.version).toBe(packageJson.version);
  });

  it("returns uptime as a positive number", async () => {
    const res = await request(createApp()).get("/health");
    expect(typeof res.body.uptime).toBe("number");
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });
});
