import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function resetDiagPerfModuleCache() {
  for (const modulePath of [
    "../../routes/diag-perf",
    "../../lib/perf-log-writer",
    "../../lib/helpers",
  ]) {
    try {
      delete require.cache[require.resolve(modulePath)];
    } catch (_error) {
      // Ignore cache misses.
    }
  }
}

function loadDiagPerfRouter() {
  try {
    resetDiagPerfModuleCache();
    return require("../../routes/diag-perf");
  } catch (error) {
    throw new Error(
      `Expected routes/diag-perf.js to exist and export an Express router. Original error: ${
        error && error.message ? error.message : String(error)
      }`,
    );
  }
}

function createApp({ writer, exporter } = {}) {
  const router = loadDiagPerfRouter();
  if (typeof router.setPerfLogWriter === "function") {
    router.setPerfLogWriter(writer || null);
  }
  if (typeof router.setPerfExporter === "function") {
    router.setPerfExporter(exporter || null);
  }

  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

describe("perf diagnostics route contract", () => {
  const originalOpenclawHome = process.env.OPENCLAW_HOME;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete Object.prototype.perfPolluted;
  });

  afterEach(() => {
    if (originalOpenclawHome === undefined) {
      delete process.env.OPENCLAW_HOME;
    } else {
      process.env.OPENCLAW_HOME = originalOpenclawHome;
    }
    resetDiagPerfModuleCache();
    delete Object.prototype.perfPolluted;
  });

  it("POST /api/diag/perf appends a received batch in one writer call", async () => {
    const appendBatch = vi.fn(async () => ({ written: 2, bytes: 512 }));
    const writer = { appendBatch };

    const payload = {
      source: "hud",
      events: [
        {
          ts: "2026-03-03T18:00:00.000Z",
          sessionId: "sess-1",
          summary: {
            "fetchAll.finish": {
              durationMs: { count: 1, sum: 21, min: 21, max: 21, last: 21 },
            },
          },
        },
        {
          ts: "2026-03-03T18:00:01.000Z",
          sessionId: "sess-1",
          summary: {
            "chatBatcher.flush": {
              batchSize: { count: 1, sum: 7, min: 7, max: 7, last: 7 },
            },
          },
        },
      ],
    };

    const res = await request(createApp({ writer })).post("/api/diag/perf").send(payload);

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ ok: true, accepted: 2 });
    expect(appendBatch).toHaveBeenCalledTimes(1);
    expect(appendBatch).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          ts: payload.events[0].ts,
          sessionId: "sess-1",
        }),
        expect.objectContaining({
          ts: payload.events[1].ts,
          sessionId: "sess-1",
        }),
      ]),
    );
  });

  it("POST /api/diag/perf preserves runId and source metadata", async () => {
    const appendBatch = vi.fn(async () => ({ written: 1, bytes: 128 }));
    const writer = { appendBatch };

    const payload = {
      source: "hud",
      events: [
        {
          ts: "2026-03-03T18:12:00.000Z",
          sessionId: "sess-run",
          runId: "run-2026",
          summary: {
            "fetchAll.finish": {
              durationMs: { count: 1, sum: 15, min: 15, max: 15, last: 15 },
            },
          },
        },
      ],
    };

    const res = await request(createApp({ writer }))
      .post("/api/diag/perf")
      .send(payload);

    expect(res.status).toBe(202);
    expect(appendBatch).toHaveBeenCalledTimes(1);
    const [[events]] = appendBatch.mock.calls;
    expect(events[0]).toMatchObject({ runId: "run-2026", source: "hud" });
  });

  it("POST /api/diag/perf rejects invalid payload and redacts sensitive fields before append", async () => {
    const appendBatch = vi.fn(async () => ({ written: 1, bytes: 128 }));
    const writer = { appendBatch };

    const invalidRes = await request(createApp({ writer }))
      .post("/api/diag/perf")
      .send({ source: "hud", events: "not-an-array" });

    expect(invalidRes.status).toBe(400);
    expect(invalidRes.body).toMatchObject({
      ok: false,
      error: expect.stringMatching(/events/i),
    });
    expect(appendBatch).not.toHaveBeenCalled();

    const validWithSecrets = {
      source: "hud",
      events: [
        {
          ts: "2026-03-03T18:02:00.000Z",
          summary: {
            "fetchAll.finish": {
              durationMs: { count: 1, sum: 14, min: 14, max: 14, last: 14 },
            },
          },
          apiKey: "sk-top-secret",
          authToken: "token-secret",
          nested: {
            authorization: "Bearer super-secret",
          },
        },
      ],
    };

    const res = await request(createApp({ writer })).post("/api/diag/perf").send(validWithSecrets);

    expect(res.status).toBe(202);
    expect(appendBatch).toHaveBeenCalledTimes(1);

    const [[events]] = appendBatch.mock.calls;
    expect(events).toHaveLength(1);
    expect(events[0]).not.toHaveProperty("apiKey");
    expect(events[0]).not.toHaveProperty("authToken");
    expect(events[0]).not.toHaveProperty("nested");
  });

  it("POST /api/diag/perf returns 413 with structured error for oversized event policy violations", async () => {
    const oversized = new Error("Serialized perf event exceeds maxBytes policy (2048 > 1024)");
    oversized.code = "E_PERF_EVENT_TOO_LARGE";
    const appendBatch = vi.fn(async () => {
      throw oversized;
    });
    const writer = { appendBatch };

    const res = await request(createApp({ writer }))
      .post("/api/diag/perf")
      .send({
        source: "hud",
        events: [
          {
            ts: "2026-03-03T18:03:00.000Z",
            summary: {
              "fetchAll.finish": {
                durationMs: { count: 1, sum: 12, min: 12, max: 12, last: 12 },
              },
            },
          },
        ],
      });

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({
      ok: false,
      code: "E_PERF_EVENT_TOO_LARGE",
      error: expect.stringMatching(/maxBytes|exceeds/i),
      repairable: true,
    });
  });

  it("appendSanitizedPerfEvents sanitizes events before appending", async () => {
    const appendBatch = vi.fn(async () => ({ written: 2, bytes: 256 }));
    const events = [
      {
        ts: "2026-03-03T18:00:00.000Z",
        source: "hud-system",
        runId: "run-helper",
        apiKey: "sk-secret",
        nested: {
          authorization: "Bearer hidden",
        },
        summary: {
          "apiTail.request": {
            status: { count: 1, sum: 200, min: 200, max: 200, last: 200 },
          },
          "__proto__": {
            polluted: { count: 1, sum: 1, min: 1, max: 1, last: 1 },
          },
        },
      },
    ];

    const router = loadDiagPerfRouter();
    router.setPerfLogWriter({ appendBatch });

    const summary = await router.appendSanitizedPerfEvents(events);

    expect(summary).toMatchObject({ accepted: 1, written: 2, bytes: 256 });
    expect(appendBatch).toHaveBeenCalledTimes(1);
    const [[writtenEvents]] = appendBatch.mock.calls;
    expect(writtenEvents).toHaveLength(1);
    expect(writtenEvents[0]).toMatchObject({
      ts: "2026-03-03T18:00:00.000Z",
      source: "hud-system",
      runId: "run-helper",
    });
    expect(writtenEvents[0]).not.toHaveProperty("apiKey");
    expect(writtenEvents[0]).not.toHaveProperty("nested");
    expect(writtenEvents[0]).not.toHaveProperty("__proto__");
    expect(writtenEvents[0].summary["apiTail.request"].status).toMatchObject({
      count: 1,
      sum: 200,
      min: 200,
      max: 200,
      last: 200,
    });
    resetDiagPerfModuleCache();
  });

  it("appendSanitizedPerfEvents rejects non-array input", async () => {
    const router = loadDiagPerfRouter();
    await expect(router.appendSanitizedPerfEvents({ a: 1 })).rejects.toThrow(
      "perf event batch must be an array",
    );
    resetDiagPerfModuleCache();
  });

  it("GET /api/diag/perf/export returns a stable summary envelope", async () => {
    const exporter = {
      buildSummary: vi.fn(async () => ({
        generatedAt: "2026-03-03T18:10:00.000Z",
        range: {
          from: "2026-03-03T18:00:00.000Z",
          to: "2026-03-03T18:10:00.000Z",
        },
        totals: {
          batches: 4,
          events: 39,
        },
        metrics: {
          "fetchAll.finish": {
            durationMs: { count: 10, sum: 980, min: 60, max: 160, last: 90 },
          },
        },
      })),
    };

    const res = await request(createApp({ exporter })).get("/api/diag/perf/export");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      summary: {
        generatedAt: expect.any(String),
        range: {
          from: expect.any(String),
          to: expect.any(String),
        },
        totals: {
          batches: expect.any(Number),
          events: expect.any(Number),
        },
        metrics: expect.any(Object),
      },
    });
    expect(exporter.buildSummary).toHaveBeenCalledTimes(1);
  });

  it("GET /api/diag/perf/export fallback includes additive run-level SLO fields when summary fails", async () => {
    const exporter = {
      buildSummary: vi.fn(async () => {
        throw new Error("summary failure");
      }),
    };

    const res = await request(createApp({ exporter })).get("/api/diag/perf/export");

    expect(res.status).toBe(500);
    expect(res.body.summary).toMatchObject({
      totals: {
        batches: 0,
        events: 0,
        runs: 0,
        sources: 0,
      },
      runLevelSlo: {
        fetchAll: {
          p95MsProxy: null,
          p99MsProxy: null,
        },
        tickToPaint: {
          p95MsProxy: null,
        },
        tail: {
          over500msCount: 0,
        },
      },
    });
  });

  it("GET /api/diag/perf/export includes runId/source summary fields", async () => {
    const writer = {
      appendBatch: vi.fn(async () => ({ written: 0, bytes: 0 })),
      config: {
        dir: fs.mkdtempSync(path.join(os.tmpdir(), "diag-perf-runids-")),
        baseName: "hud-perf",
      },
    };
    const segmentPath = path.join(writer.config.dir, "hud-perf-000001.jsonl");
    const lines = [
      JSON.stringify({
        ts: "2026-03-03T18:00:00.000Z",
        runId: "run-1",
        source: "hud",
        _batchId: "batch-a",
        summary: {
          "fetchAll.finish": {
            durationMs: { count: 1, sum: 10, min: 10, max: 10, last: 10 },
          },
        },
      }),
      JSON.stringify({
        ts: "2026-03-03T18:00:01.000Z",
        runId: "run-2",
        source: "system-viewer",
        _batchId: "batch-b",
        summary: {
          "system.power": {
            gpuPowerW: { count: 1, sum: 14, min: 14, max: 14, last: 14 },
          },
        },
      }),
    ];
    fs.writeFileSync(segmentPath, `${lines.join("\n")}\n`, "utf8");

    try {
      const app = createApp({ writer });
      const res = await request(app).get("/api/diag/perf/export");

      expect(res.status).toBe(200);
      expect(res.body.summary).toMatchObject({
        totals: {
          runs: 2,
        },
      });
      expect(res.body.summary.runIds).toEqual(expect.arrayContaining(["run-1", "run-2"]));
      expect(res.body.summary.sourceCounts).toMatchObject({
        hud: 1,
        "system-viewer": 1,
      });
    } finally {
      fs.rmSync(writer.config.dir, { recursive: true, force: true });
    }
  });

  it("GET /api/diag/perf/export includes additive run-level SLO proxy fields", async () => {
    const perfDir = fs.mkdtempSync(path.join(os.tmpdir(), "diag-perf-slo-"));
    const segmentPath = path.join(perfDir, "hud-perf-000001.jsonl");
    const lines = [
      JSON.stringify({
        ts: "2026-03-03T18:00:00.000Z",
        source: "hud",
        _batchId: "batch-a",
        summary: {
          "fetchAll.finish": {
            durationMs: { count: 1, sum: 120, min: 120, max: 120, last: 120 },
          },
          tickToPaint: {
            durationMs: { count: 1, sum: 60, min: 60, max: 60, last: 60 },
          },
        },
      }),
      JSON.stringify({
        ts: "2026-03-03T18:00:01.000Z",
        source: "hud",
        _batchId: "batch-b",
        summary: {
          "fetchAll.finish": {
            durationMs: { count: 1, sum: 700, min: 700, max: 700, last: 700 },
          },
          tickToPaint: {
            durationMs: { count: 1, sum: 240, min: 240, max: 240, last: 240 },
          },
        },
      }),
      JSON.stringify({
        ts: "2026-03-03T18:00:02.000Z",
        source: "hud",
        _batchId: "batch-c",
        summary: {
          "fetchAll.finish": {
            durationMs: { count: 1, sum: 40, min: 40, max: 40, last: 40 },
          },
        },
      }),
    ];
    fs.writeFileSync(segmentPath, `${lines.join("\n")}\n`, "utf8");

    try {
      const writer = {
        appendBatch: vi.fn(async () => ({ written: 0, bytes: 0 })),
        config: {
          dir: perfDir,
          baseName: "hud-perf",
        },
      };
      const res = await request(createApp({ writer })).get("/api/diag/perf/export");

      expect(res.status).toBe(200);
      expect(res.body.summary.runLevelSlo).toMatchObject({
        fetchAll: {
          p95MsProxy: 700,
          p99MsProxy: 700,
        },
        tickToPaint: {
          p95MsProxy: 240,
        },
        tail: {
          over500msCount: 1,
        },
      });
    } finally {
      fs.rmSync(perfDir, { recursive: true, force: true });
    }
  });

  it("GET /api/diag/perf/export avoids max-weight inflation and uses explicit over500 counters", async () => {
    const perfDir = fs.mkdtempSync(path.join(os.tmpdir(), "diag-perf-slo-aggregated-"));
    const segmentPath = path.join(perfDir, "hud-perf-000001.jsonl");
    const lines = [
      JSON.stringify({
        ts: "2026-03-03T19:00:00.000Z",
        source: "hud",
        _batchId: "batch-a",
        summary: {
          "fetchAll.finish": {
            durationMs: { count: 10, sum: 1000, min: 20, max: 900, last: 30 },
            over500ms: { count: 10, sum: 1, min: 0, max: 1, last: 1 },
          },
          tickToPaint: {
            durationMs: { count: 10, sum: 500, min: 20, max: 120, last: 40 },
          },
        },
      }),
      JSON.stringify({
        ts: "2026-03-03T19:00:30.000Z",
        source: "hud",
        _batchId: "batch-b",
        summary: {
          "fetchAll.finish": {
            durationMs: { count: 10, sum: 300, min: 20, max: 40, last: 25 },
            over500ms: { count: 10, sum: 0, min: 0, max: 0, last: 0 },
          },
          tickToPaint: {
            durationMs: { count: 10, sum: 600, min: 20, max: 90, last: 45 },
          },
        },
      }),
    ];
    fs.writeFileSync(segmentPath, `${lines.join("\n")}\n`, "utf8");

    try {
      const writer = {
        appendBatch: vi.fn(async () => ({ written: 0, bytes: 0 })),
        config: {
          dir: perfDir,
          baseName: "hud-perf",
        },
      };
      const res = await request(createApp({ writer })).get("/api/diag/perf/export");

      expect(res.status).toBe(200);
      expect(res.body.summary.runLevelSlo).toMatchObject({
        fetchAll: {
          p95MsProxy: 30,
          p99MsProxy: 30,
        },
        tickToPaint: {
          p95MsProxy: 45,
        },
        tail: {
          over500msCount: 1,
        },
      });
    } finally {
      fs.rmSync(perfDir, { recursive: true, force: true });
    }
  });

  it("GET /api/diag/perf/export counts all parsed persisted events while range uses valid timestamps only", async () => {
    const perfDir = fs.mkdtempSync(path.join(os.tmpdir(), "diag-perf-range-"));
    const segmentPath = path.join(perfDir, "hud-perf-000001.jsonl");
    const lines = [
      JSON.stringify({
        ts: "2026-03-03T18:00:00.000Z",
        _batchId: "batch-a",
        summary: {
          "fetchAll.finish": {
            durationMs: { count: 1, sum: 10, min: 10, max: 10, last: 10 },
          },
        },
      }),
      JSON.stringify({
        ts: "2026-03-03T18:10:00.000Z",
        _batchId: "batch-b",
      }),
      JSON.stringify({
        ts: "2026-03-03T18:20:00.000Z",
        _batchId: "batch-c",
        summary: "not-an-object",
      }),
      JSON.stringify({
        ts: "not-a-valid-timestamp",
        _batchId: "batch-d",
        summary: {
          "fetchAll.finish": {
            durationMs: { count: 1, sum: 20, min: 20, max: 20, last: 20 },
          },
        },
      }),
      JSON.stringify({
        _batchId: "batch-e",
        summary: {
          "fetchAll.finish": {
            durationMs: { count: 1, sum: 30, min: 30, max: 30, last: 30 },
          },
        },
      }),
    ];
    fs.writeFileSync(segmentPath, `${lines.join("\n")}\n`, "utf8");

    try {
      const writer = {
        appendBatch: vi.fn(async () => ({ written: 0, bytes: 0 })),
        config: {
          dir: perfDir,
          baseName: "hud-perf",
        },
      };
      const res = await request(createApp({ writer })).get("/api/diag/perf/export");

      expect(res.status).toBe(200);
      expect(res.body.summary.range).toEqual({
        from: "2026-03-03T18:00:00.000Z",
        to: "2026-03-03T18:20:00.000Z",
      });
      expect(res.body.summary.totals.events).toBe(5);
      expect(res.body.summary.metrics).toHaveProperty("fetchAll.finish");
    } finally {
      fs.rmSync(perfDir, { recursive: true, force: true });
    }
  });

  it("initializes default writer config from centralized perf writer defaults", () => {
    resetDiagPerfModuleCache();
    const perfWriterModule = require("../../lib/perf-log-writer");
    const createPerfLogWriterSpy = vi.spyOn(perfWriterModule, "createPerfLogWriter");

    const router = require("../../routes/diag-perf");
    expect(router).toBeTruthy();
    expect(createPerfLogWriterSpy).toHaveBeenCalledTimes(1);
    expect(createPerfLogWriterSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        dir: perfWriterModule.PERF_LOG_WRITER_DEFAULTS.dir,
        maxBytes: perfWriterModule.PERF_LOG_WRITER_DEFAULTS.maxBytes,
        maxFiles: perfWriterModule.PERF_LOG_WRITER_DEFAULTS.maxFiles,
      }),
    );
    expect(createPerfLogWriterSpy.mock.calls[0][0]).not.toHaveProperty("baseName");
  });

  it("POST /api/diag/perf strips unknown fields and dangerous keys from persisted event schema", async () => {
    const appendBatch = vi.fn(async () => ({ written: 1, bytes: 64 }));
    const writer = { appendBatch };
    const event = JSON.parse(`{
      "ts": "2026-03-03T18:15:00.000Z",
      "_batchId": "batch-1",
      "unknownRoot": "drop-me",
      "constructor": { "sneaky": true },
      "summary": {
        "fetchAll.finish": {
          "durationMs": {
            "count": 1,
            "sum": 18,
            "min": 18,
            "max": 18,
            "last": 18,
            "p95": 18
          }
        },
        "__proto__": {
          "perfPolluted": {
            "count": 1,
            "sum": 1,
            "min": 1,
            "max": 1,
            "last": 1
          }
        }
      }
    }`);

    const res = await request(createApp({ writer }))
      .post("/api/diag/perf")
      .send({
        source: "hud",
        events: [event],
      });

    expect(res.status).toBe(202);
    expect(appendBatch).toHaveBeenCalledTimes(1);

    const [[events]] = appendBatch.mock.calls;
    expect(events).toHaveLength(1);
    expect(events[0]).toHaveProperty("ts", "2026-03-03T18:15:00.000Z");
    expect(events[0]).toHaveProperty("_batchId", "batch-1");
    expect(events[0]).not.toHaveProperty("unknownRoot");
    expect(events[0]).not.toHaveProperty("constructor");
    expect(events[0].summary).not.toHaveProperty("__proto__");
    expect(events[0].summary["fetchAll.finish"].durationMs).not.toHaveProperty("p95");
    expect(Object.prototype.perfPolluted).toBeUndefined();
  });

  it("GET /api/diag/perf/export ignores constructor and __proto__ summary keys without mutating global prototypes", async () => {
    const perfDir = fs.mkdtempSync(path.join(os.tmpdir(), "diag-perf-export-"));
    const segmentPath = path.join(perfDir, "hud-perf-000001.jsonl");
    const maliciousEntry = JSON.parse(`{
      "ts": "2026-03-03T18:20:00.000Z",
      "_batchId": "batch-2",
      "summary": {
        "__proto__": {
          "perfPolluted": {
            "count": 1,
            "sum": 1,
            "min": 1,
            "max": 1,
            "last": 1
          }
        },
        "constructor": {
          "sneakyField": {
            "count": 1,
            "sum": 2,
            "min": 2,
            "max": 2,
            "last": 2
          }
        },
        "fetchAll.finish": {
          "durationMs": {
            "count": 1,
            "sum": 12,
            "min": 12,
            "max": 12,
            "last": 12
          }
        }
      }
    }`);
    fs.writeFileSync(
      segmentPath,
      `${JSON.stringify(maliciousEntry)}\n`,
      "utf8",
    );

    try {
      const writer = {
        appendBatch: vi.fn(async () => ({ written: 0, bytes: 0 })),
        config: {
          dir: perfDir,
          baseName: "hud-perf",
        },
      };
      const app = createApp({ writer });
      const res = await request(app).get("/api/diag/perf/export");

      expect(res.status).toBe(200);
      expect(res.body.summary.metrics).toHaveProperty("fetchAll.finish");
      expect(res.body.summary.metrics).not.toHaveProperty("constructor");
      expect(res.body.summary.metrics).not.toHaveProperty("__proto__");
      expect(Object.prototype.perfPolluted).toBeUndefined();
    } finally {
      fs.rmSync(perfDir, { recursive: true, force: true });
      delete Object.prototype.perfPolluted;
    }
  });

  it("does not crash route load when perf writer initialization fails and degrades endpoint behavior", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diag-perf-init-"));
    const blockedOpenclawHome = path.join(tmpDir, "openclaw-home-file");
    fs.writeFileSync(blockedOpenclawHome, "block perf dir creation", "utf8");
    process.env.OPENCLAW_HOME = blockedOpenclawHome;
    resetDiagPerfModuleCache();

    try {
      let app;
      expect(() => {
        app = createApp();
      }).not.toThrow();

      const res = await request(app).post("/api/diag/perf").send({
        source: "hud",
        events: [{ ts: "2026-03-03T18:30:00.000Z", summary: {} }],
      });
      expect([202, 503]).toContain(res.status);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("POST /api/diag/perf/system maps macOS power/thermal samples and persists runId-shared events", async () => {
    const appendBatch = vi.fn(async () => ({ written: 1, bytes: 256 }));
    const writer = { appendBatch };

    const res = await request(createApp({ writer }))
      .post("/api/diag/perf/system")
      .send({
        runId: "run-mac-001",
        source: "viewer-macos",
        ts: "2026-03-03T19:00:00.000Z",
        power: {
          gpuPowerW: 22.5,
          cpuPowerW: 15.1,
        },
        thermal: {
          cpuTempC: 87,
          thermalPressure: 2,
        },
        capture: {
          powermetricsAttempts: 1,
          powermetricsSuccesses: 1,
          powermetricsFailures: 0,
          powermetricsUnavailable: 0,
          thermlogAttempts: 1,
          thermlogSuccesses: 1,
          thermlogFailures: 0,
          thermlogUnavailable: 0,
        },
      });

    expect(res.status).toBe(202);
    expect(appendBatch).toHaveBeenCalledTimes(1);
    const [[events]] = appendBatch.mock.calls;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      runId: "run-mac-001",
      source: "viewer-macos",
      ts: "2026-03-03T19:00:00.000Z",
    });
    expect(events[0]).toHaveProperty(["summary", "system.power", "gpuPowerW"]);
    expect(events[0]).toHaveProperty(["summary", "system.thermal", "thermalPressure"]);
    expect(events[0]).toHaveProperty(["summary", "system.capture", "powermetricsFailures"]);
  });

  it("POST /api/diag/perf/system requires runId and returns validation errors on bad payload", async () => {
    const appendBatch = vi.fn(async () => ({ written: 0, bytes: 0 }));
    const writer = { appendBatch };

    const res = await request(createApp({ writer })).post("/api/diag/perf/system").send({
      source: "viewer-macos",
      thermal: {
        cpuTempC: 50,
      },
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: expect.stringMatching(/runId/i) });
    expect(appendBatch).not.toHaveBeenCalled();
  });
});
