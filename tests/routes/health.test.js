import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// Store original Date.now
const originalDateNow = Date.now;
const mockStartTime = 1700000000000;

// Mock fs module
vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

function createApp() {
  const router = require("../../routes/health");
  const app = express();
  app.use(router);
  return app;
}

describe("GET /health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock Date.now to return controlled time
    Date.now = vi.fn().mockReturnValue(mockStartTime + 3600000); // 1 hour after start
  });

  afterEach(() => {
    Date.now = originalDateNow;
  });

  it("should return 200 with health status and required fields", async () => {
    const res = await request(createApp()).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status");
    expect(res.body).toHaveProperty("version");
    expect(res.body).toHaveProperty("uptime");
    expect(res.body).toHaveProperty("checks");

    expect(res.body.status).toBe("healthy");
    expect(res.body.checks).toHaveProperty("websocket");
    expect(res.body.checks).toHaveProperty("filesystem");
  });

  it("should return correct version from package.json", async () => {
    const res = await request(createApp()).get("/health");
    const packageJson = require("../../package.json");

    expect(res.body.version).toBe(packageJson.version);
  });

  it("should return uptime as a positive number", async () => {
    const res = await request(createApp()).get("/health");

    expect(typeof res.body.uptime).toBe("number");
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });
});
