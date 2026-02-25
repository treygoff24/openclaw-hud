import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const usageRpc = require("../../lib/usage-rpc");
const usageArchive = require("../../lib/usage-archive");

const originalRequestSessionsUsage = usageRpc.requestSessionsUsage;
const originalReadWeeklyHistory = usageArchive.readWeeklyHistory;
const originalReadWeeklySnapshot = usageArchive.readWeeklySnapshot;

function createApp() {
  delete require.cache[require.resolve("../../routes/model-usage")];
  const router = require("../../routes/model-usage");
  const app = express();
  app.use(router);
  return app;
}

describe("model usage archive routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usageRpc.requestSessionsUsage = vi.fn().mockResolvedValue({ ok: true, result: { rows: [] } });
    usageArchive.readWeeklyHistory = vi.fn().mockReturnValue([
      {
        meta: {
          period: "weekly",
          weekStart: "2026-02-15T06:00:00.000Z",
          generatedAt: "2026-02-22T06:00:00.000Z",
        },
        models: [],
        totals: { totalTokens: 25, totalCost: 1.23 },
      },
    ]);
    usageArchive.readWeeklySnapshot = vi.fn().mockReturnValue({
      meta: {
        period: "weekly",
        weekStart: "2026-02-15T06:00:00.000Z",
        generatedAt: "2026-02-22T06:00:00.000Z",
      },
      models: [],
      totals: { totalTokens: 25, totalCost: 1.23 },
    });
  });

  afterEach(() => {
    usageRpc.requestSessionsUsage = originalRequestSessionsUsage;
    usageArchive.readWeeklyHistory = originalReadWeeklyHistory;
    usageArchive.readWeeklySnapshot = originalReadWeeklySnapshot;
    vi.restoreAllMocks();
  });

  it("GET /api/model-usage/history returns archive history only", async () => {
    const res = await request(createApp()).get("/api/model-usage/history");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ snapshots: usageArchive.readWeeklyHistory.mock.results[0].value });
    expect(usageArchive.readWeeklyHistory).toHaveBeenCalledTimes(1);
    expect(usageArchive.readWeeklySnapshot).not.toHaveBeenCalled();
    expect(usageRpc.requestSessionsUsage).not.toHaveBeenCalled();
  });

  it("GET /api/model-usage/history?weekStart=... returns a single archived snapshot", async () => {
    const res = await request(createApp()).get("/api/model-usage/history?weekStart=2026-02-15");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ snapshot: usageArchive.readWeeklySnapshot.mock.results[0].value });
    expect(usageArchive.readWeeklySnapshot).toHaveBeenCalledWith("2026-02-15");
    expect(usageArchive.readWeeklyHistory).not.toHaveBeenCalled();
    expect(usageRpc.requestSessionsUsage).not.toHaveBeenCalled();
  });

  it("returns 404 when a requested archive week does not exist", async () => {
    usageArchive.readWeeklySnapshot = vi.fn().mockReturnValue(null);

    const res = await request(createApp()).get("/api/model-usage/history?weekStart=2026-02-01");

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("No archived usage snapshot found");
  });

  it("live-weekly route does not read archive", async () => {
    const res = await request(createApp()).get("/api/model-usage/live-weekly");

    expect(res.status).toBe(200);
    expect(usageRpc.requestSessionsUsage).toHaveBeenCalledTimes(1);
    expect(usageArchive.readWeeklyHistory).not.toHaveBeenCalled();
    expect(usageArchive.readWeeklySnapshot).not.toHaveBeenCalled();
  });
});
