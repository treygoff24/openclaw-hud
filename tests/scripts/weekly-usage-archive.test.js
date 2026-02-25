import { describe, it, expect, vi } from "vitest";

const { getArchiveWeekWindows, archiveWeeklyUsage } =
  await import("../../scripts/weekly-usage-archive.js");

describe("weekly usage archive script", () => {
  it("selects the just-ended previous week when run Sunday shortly after midnight", () => {
    const tz = "America/Chicago";
    const nowMs = Date.parse("2026-02-22T00:05:00-06:00"); // Sunday 00:05 local

    const windows = getArchiveWeekWindows(
      { tz, nowMs },
      {
        readWeeklyHistory: () => [],
      },
    );

    expect(windows).toEqual([
      {
        fromMs: Date.parse("2026-02-15T00:00:00-06:00"),
        toMs: Date.parse("2026-02-22T00:00:00-06:00"),
      },
    ]);
  });

  it("treats EEXIST archive writes as idempotent success in cron flow", async () => {
    const requestSessionsUsage = vi.fn().mockResolvedValue({ ok: true, result: { rows: [] } });
    const loadPricingCatalog = vi.fn(() => ({ providers: {} }));
    const repriceModelUsageRows = vi.fn((rows) => ({ rows, missingPricingModels: [] }));
    const writeWeeklySnapshot = vi.fn(() => {
      const err = new Error("file exists");
      err.code = "EEXIST";
      throw err;
    });

    const result = await archiveWeeklyUsage(
      {
        tz: "America/Chicago",
        nowMs: Date.parse("2026-02-22T00:05:00-06:00"),
      },
      {
        requestSessionsUsage,
        loadPricingCatalog,
        repriceModelUsageRows,
        writeWeeklySnapshot,
      },
    );

    expect(result.ok).toBe(true);
    expect(result.alreadyArchived).toBe(true);
    expect(writeWeeklySnapshot).toHaveBeenCalledTimes(1);
    expect(requestSessionsUsage).toHaveBeenCalledWith({
      from: Date.parse("2026-02-15T00:00:00-06:00"),
      to: Date.parse("2026-02-22T00:00:00-06:00"),
      timezone: "America/Chicago",
    });
  });

  it("backfills missed weekly windows since latest archived week", async () => {
    const requestSessionsUsage = vi.fn().mockResolvedValue({ ok: true, result: { rows: [] } });
    const loadPricingCatalog = vi.fn(() => ({ providers: {} }));
    const repriceModelUsageRows = vi.fn((rows) => ({ rows, missingPricingModels: [] }));
    const writeWeeklySnapshot = vi.fn(() => ({ path: "/tmp/snapshot.json" }));
    const readWeeklyHistory = vi.fn(() => [
      {
        meta: {
          weekStart: "2026-02-15T06:00:00.000Z",
        },
      },
    ]);

    const result = await archiveWeeklyUsage(
      {
        tz: "America/Chicago",
        nowMs: Date.parse("2026-03-08T00:05:00-06:00"),
      },
      {
        requestSessionsUsage,
        loadPricingCatalog,
        repriceModelUsageRows,
        writeWeeklySnapshot,
        readWeeklyHistory,
      },
    );

    expect(result.ok).toBe(true);
    expect(requestSessionsUsage).toHaveBeenCalledTimes(2);
    expect(requestSessionsUsage).toHaveBeenNthCalledWith(1, {
      from: Date.parse("2026-02-22T00:00:00-06:00"),
      to: Date.parse("2026-03-01T00:00:00-06:00"),
      timezone: "America/Chicago",
    });
    expect(requestSessionsUsage).toHaveBeenNthCalledWith(2, {
      from: Date.parse("2026-03-01T00:00:00-06:00"),
      to: Date.parse("2026-03-08T00:00:00-06:00"),
      timezone: "America/Chicago",
    });
    expect(writeWeeklySnapshot).toHaveBeenCalledTimes(2);
    expect(result.weekStart).toBe("2026-03-01T06:00:00.000Z");
  });
});
