import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPerfLogWriter, sanitizePerfEvent, PERF_LOG_WRITER_DEFAULTS } from "../../lib/perf-log-writer.js";

const TMP_ROOT = path.join(os.tmpdir(), `perf-log-writer-test-${Date.now()}`);

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("perf log writer rotation", () => {
  it("exports canonical writer defaults and applies them when options are omitted", async () => {
    expect(PERF_LOG_WRITER_DEFAULTS).toMatchObject({
      maxBytes: expect.any(Number),
      maxFiles: expect.any(Number),
      baseName: expect.any(String),
    });

    const writer = createPerfLogWriter({
      dir: TMP_ROOT,
    });

    expect(writer.config).toMatchObject({
      dir: TMP_ROOT,
      maxBytes: PERF_LOG_WRITER_DEFAULTS.maxBytes,
      maxFiles: PERF_LOG_WRITER_DEFAULTS.maxFiles,
    });

    expect(writer.config.baseName).toMatch(/^hud-perf-\d{8}T\d{9}Z-[a-z0-9]+-[0-9]+-[0-9a-f]{8}$/);
    expect(writer.config.baseName).not.toBe(PERF_LOG_WRITER_DEFAULTS.baseName);
  });

  it("keeps an explicit baseName untouched", async () => {
    const explicitBaseName = "hud-perf-explicit";

    const writer = createPerfLogWriter({
      dir: TMP_ROOT,
      baseName: explicitBaseName,
      maxBytes: 220,
    });

    expect(writer.config.baseName).toBe(explicitBaseName);
  });

  it("generates distinct default base names for separate writers", async () => {

    const writerA = createPerfLogWriter({
      dir: TMP_ROOT,
      maxBytes: 220,
    });
    const writerB = createPerfLogWriter({
      dir: TMP_ROOT,
      maxBytes: 220,
    });

    expect(writerA.config.baseName).not.toBe(writerB.config.baseName);

    await writerA.appendBatch([
      {
        ts: "2026-03-03T18:00:00.000Z",
        summary: {
          "fetchAll.finish": {
            countMs: { count: 1, sum: 111, min: 111, max: 111, last: 111 },
          },
        },
      },
    ]);
    await writerB.appendBatch([
      {
        ts: "2026-03-03T18:00:01.000Z",
        summary: {
          "fetchAll.finish": {
            countMs: { count: 1, sum: 112, min: 112, max: 112, last: 112 },
          },
        },
      },
    ]);

    const segmentEntries = fs.readdirSync(TMP_ROOT).filter((name) => name.endsWith(".jsonl"));
    expect(segmentEntries).toHaveLength(2);
    expect(new Set(segmentEntries).size).toBe(2);
  });

  it("rotates to a new segment when maxBytes is exceeded", async () => {

    const writer = createPerfLogWriter({
      dir: TMP_ROOT,
      baseName: "hud-perf",
      maxBytes: 220,
      maxFiles: 4,
    });

    await writer.appendBatch([
      {
        ts: "2026-03-03T18:00:00.000Z",
        summary: {
          "fetchAll.finish": { durationMs: { count: 1, sum: 111, min: 111, max: 111, last: 111 } },
        },
      },
      {
        ts: "2026-03-03T18:00:01.000Z",
        summary: {
          "fetchAll.finish": { durationMs: { count: 1, sum: 112, min: 112, max: 112, last: 112 } },
        },
      },
    ]);

    await writer.appendBatch([
      {
        ts: "2026-03-03T18:00:02.000Z",
        summary: {
          "fetchAll.finish": { durationMs: { count: 1, sum: 113, min: 113, max: 113, last: 113 } },
        },
      },
      {
        ts: "2026-03-03T18:00:03.000Z",
        summary: {
          "fetchAll.finish": { durationMs: { count: 1, sum: 114, min: 114, max: 114, last: 114 } },
        },
      },
    ]);

    const entries = fs.readdirSync(TMP_ROOT).filter((name) => name.startsWith("hud-perf"));
    expect(entries.length).toBeGreaterThanOrEqual(2);
  });

  it("enforces maxFiles retention during repeated rotations", async () => {

    const writer = createPerfLogWriter({
      dir: TMP_ROOT,
      baseName: "hud-perf",
      maxBytes: 150,
      maxFiles: 2,
    });

    for (let i = 0; i < 8; i += 1) {
      await writer.appendBatch([
        {
          ts: `2026-03-03T18:00:0${i}.000Z`,
          summary: {
            "chatBatcher.flush": {
              durationMs: { count: 1, sum: 80 + i, min: 80 + i, max: 80 + i, last: 80 + i },
            },
          },
        },
      ]);
    }

    const entries = fs.readdirSync(TMP_ROOT).filter((name) => name.startsWith("hud-perf"));
    expect(entries.length).toBeLessThanOrEqual(2);
  });

  it("rejects oversized single events instead of bypassing maxBytes rotation policy", async () => {

    const writer = createPerfLogWriter({
      dir: TMP_ROOT,
      baseName: "hud-perf",
      maxBytes: 120,
      maxFiles: 3,
    });

    const oversizedEvent = {
      ts: "2026-03-03T18:55:00.000Z",
      summary: {
        [`metric-${"x".repeat(400)}`]: {
          durationMs: { count: 1, sum: 99, min: 99, max: 99, last: 99 },
        },
      },
    };

    await expect(writer.appendBatch([oversizedEvent])).rejects.toThrow(
      /maxBytes|exceeds|oversized/i,
    );

    expect(writer.readSegmentPaths()).toHaveLength(0);
  });

  it("persists only the whitelisted perf schema fields and strips unknown fields", async () => {

    const writer = createPerfLogWriter({
      dir: TMP_ROOT,
      baseName: "hud-perf",
      maxBytes: 1024,
      maxFiles: 3,
    });

    const event = JSON.parse(`{
      "ts": "2026-03-03T18:40:00.000Z",
      "_batchId": "batch-4",
      "sessionId": "session-1",
      "debugContext": "remove-me",
      "constructor": { "sneaky": true },
      "summary": {
        "fetchAll.finish": {
          "durationMs": {
            "count": 1,
            "sum": 25,
            "min": 25,
            "max": 25,
            "last": 25,
            "p95": 25
          },
          "debugField": "drop-me"
        },
        "__proto__": {
          "polluted": {
            "count": 1,
            "sum": 1,
            "min": 1,
            "max": 1,
            "last": 1
          }
        }
      }
    }`);

    await writer.appendBatch([event]);

    const [segmentPath] = writer.readSegmentPaths();
    const raw = fs.readFileSync(segmentPath, "utf8").trim();
    const persisted = JSON.parse(raw);

    expect(persisted).toHaveProperty("ts", "2026-03-03T18:40:00.000Z");
    expect(persisted).toHaveProperty("_batchId", "batch-4");
    expect(persisted).not.toHaveProperty("debugContext");
    expect(persisted).not.toHaveProperty("constructor");
    expect(persisted.summary).not.toHaveProperty("__proto__");
    expect(persisted.summary["fetchAll.finish"]).not.toHaveProperty("debugField");
    expect(persisted.summary["fetchAll.finish"].durationMs).toEqual({
      count: 1,
      sum: 25,
      min: 25,
      max: 25,
      last: 25,
    });
  });

  it("persists runId and source in sanitized event payload", async () => {

    const writer = createPerfLogWriter({
      dir: TMP_ROOT,
      baseName: "hud-perf",
      maxBytes: 1024,
      maxFiles: 3,
    });

    await writer.appendBatch([
      {
        ts: "2026-03-03T20:05:00.000Z",
        runId: "run-abc-001",
        source: "hud",
        summary: {
          "fetchAll.finish": {
            durationMs: { count: 1, sum: 25, min: 25, max: 25, last: 25 },
          },
        },
      },
    ]);

    const [segmentPath] = writer.readSegmentPaths();
    const persisted = JSON.parse(fs.readFileSync(segmentPath, "utf8").trim());

    expect(persisted).toMatchObject({
      runId: "run-abc-001",
      source: "hud",
    });
  });

  it("drops unknown object-valued top-level keys from sanitized and persisted events", async () => {

    const writer = createPerfLogWriter({
      dir: TMP_ROOT,
      baseName: "hud-perf",
      maxBytes: 1024,
      maxFiles: 3,
    });

    const event = {
      ts: "2026-03-03T19:10:00.000Z",
      _batchId: "batch-strict-1",
      sessionId: "session-strict-1",
      summary: {
        "fetchAll.finish": {
          durationMs: { count: 1, sum: 14, min: 14, max: 14, last: 14 },
        },
      },
      unknownObjectContext: {
        leak: "should-not-persist",
        nested: { stillLeak: true },
      },
      extraMetrics: {
        cpu: 98,
      },
    };

    const sanitized = sanitizePerfEvent(event);
    expect(sanitized).not.toHaveProperty("unknownObjectContext");
    expect(sanitized).not.toHaveProperty("extraMetrics");

    await writer.appendBatch([event]);

    const [segmentPath] = writer.readSegmentPaths();
    const raw = fs.readFileSync(segmentPath, "utf8").trim();
    const persisted = JSON.parse(raw);

    expect(persisted).not.toHaveProperty("unknownObjectContext");
    expect(persisted).not.toHaveProperty("extraMetrics");
  });

  it("persists bounded API-tail fields and strips unbounded payloads", async () => {

    const writer = createPerfLogWriter({
      dir: TMP_ROOT,
      baseName: "hud-perf",
      maxBytes: 2048,
      maxFiles: 3,
    });

    const longEndpoint = `/api/${"x".repeat(512)}`;
    const longMethod = `VERYLONGHTTPMETHOD-${"m".repeat(128)}`;
    const longWorkload = `models-${"w".repeat(256)}`;
    const longCacheName = `cache-${"c".repeat(256)}`;
    const longCacheKey = `key-${"k".repeat(256)}`;
    const longRequestId = `req-${"r".repeat(1024)}`;

    await writer.appendBatch([
      {
        ts: "2026-03-03T21:10:00.000Z",
        endpoint: longEndpoint,
        method: longMethod,
        status: 204,
        workload: longWorkload,
        requestId: longRequestId,
        queueMsProxy: 15.7,
        etagHit: 1,
        bytesOut: 4096.9,
        totalMs: -15.2,
        cacheState: {
          state: "hit",
          cacheName: longCacheName,
          key: longCacheKey,
          ageMs: 12.2,
          ttlMs: 44.8,
          nested: { shouldDrop: true },
        },
        summary: {
          "apiTail.request": {
            status: { count: 1, sum: 204, min: 204, max: 204, last: 204 },
          },
        },
      },
    ]);

    const [segmentPath] = writer.readSegmentPaths();
    const persisted = JSON.parse(fs.readFileSync(segmentPath, "utf8").trim());

    expect(persisted.endpoint).toBe(longEndpoint.slice(0, 256));
    expect(persisted.method).toBe(longMethod.slice(0, 16));
    expect(persisted.status).toBe(204);
    expect(persisted.workload).toBe(longWorkload.slice(0, 128));
    expect(persisted.requestId).toBe(longRequestId.slice(0, 128));
    expect(persisted.queueMsProxy).toBe(15.7);
    expect(persisted.etagHit).toBe(true);
    expect(persisted.bytesOut).toBe(4096);
    expect(persisted.totalMs).toBe(0);
    expect(persisted.cacheState).toMatchObject({
      state: "hit",
      cacheName: longCacheName.slice(0, 128),
      key: longCacheKey.slice(0, 128),
      ageMs: 12,
      ttlMs: 44,
    });
    expect(persisted.cacheState).not.toHaveProperty("nested");
  });

  it("does not throw during writer creation when target perf directory cannot be created", async () => {
    const blockedPath = path.join(TMP_ROOT, "openclaw-home-file");
    fs.writeFileSync(blockedPath, "not-a-directory", "utf8");

    expect(() =>
      createPerfLogWriter({
        dir: path.join(blockedPath, "state", "perf"),
        baseName: "hud-perf",
      }),
    ).not.toThrow();
  });

  it("returns an unavailable writer contract when append target is invalid", async () => {
    const invalidDir = path.join(TMP_ROOT, "\u0000");
    const writer = createPerfLogWriter({
      dir: invalidDir,
      baseName: "hud-perf",
    });

    expect(writer).toMatchObject({
      isAvailable: false,
      config: expect.objectContaining({ dir: invalidDir, baseName: "hud-perf" }),
    });

    const result = writer.appendBatch([{ ts: "2026-03-03T00:00:00.000Z", summary: {} }]);

    await expect(result).rejects.toMatchObject({
      code: "E_PERF_LOG_WRITER_UNAVAILABLE",
    });
    await expect(result).rejects.toHaveProperty("message");
  });

  it("throws when appendBatch receives a non-array payload and leaves writer untouched", async () => {
    const writer = createPerfLogWriter({
      dir: TMP_ROOT,
      baseName: "hud-perf",
    });
    await expect(writer.appendBatch(null)).resolves.toMatchObject({
      written: 0,
      bytes: 0,
    });
    expect(writer.readSegmentPaths()).toHaveLength(0);
  });
});
