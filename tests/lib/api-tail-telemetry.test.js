import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

const { createApiTailTelemetryMiddleware } = require("../../lib/api-tail-telemetry");

function createApp({ appendPerfEvents, sampleRate = 0, slowRequestMs = 500, randomFn = () => 0 }) {
  const middleware = createApiTailTelemetryMiddleware({
    appendPerfEvents,
    sampleRate,
    slowRequestMs,
    randomFn,
  });

  const app = express();
  app.use("/api", middleware);
  app.get("/api/fast", (_req, res) => res.send("fast"));
  app.get("/api/slow", (_req, res) => {
    setTimeout(() => {
      res.status(200).send("slow");
    }, 8);
  });
  app.get("/api/models", (_req, res) => {
    res.locals.apiTailTelemetry = {
      phases: {
        diskReadMs: 11,
        parseMs: 5,
        computeMs: 7,
        serializeMs: 9,
      },
      workload: "models",
      cacheState: { state: "hit", cacheName: "api-models", key: "models" },
      queueMsProxy: 3,
    };
    res.send("models");
  });
  app.get("/api/etag", (req, res) => {
    res.set("ETag", '"abc"');
    res.locals.apiTailTelemetry = {
      phases: {
        serializeMs: 9,
      },
      workload: "models",
      cacheState: { state: "miss", cacheName: "api-models", key: "models" },
      queueMsProxy: 2,
    };
    return res.sendStatus(304);
  });
  app.get("/api/session-log/:agentId/:sessionId", (_req, res) => {
    res.send("session-log");
  });
  app.get("/api/streaming", (_req, res) => {
    res.write("hello");
    res.write(" ");
    res.end("world");
  });
  return app;
}

function waitForTelemetryFlush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("api tail telemetry middleware", () => {
  it("records telemetry for requests meeting slow threshold regardless of sample rate", async () => {
    const appendPerfEvents = vi.fn(async () => ({ accepted: 1 }));
    const app = createApp({
      appendPerfEvents,
      sampleRate: 0,
      slowRequestMs: 5,
    });

    const res = await request(app).get("/api/slow");
    expect(res.status).toBe(200);
    await waitForTelemetryFlush();

    expect(appendPerfEvents).toHaveBeenCalledTimes(1);
    const event = appendPerfEvents.mock.calls.at(-1)[0][0];
    expect(event).toMatchObject({
      endpoint: "/api/slow",
      method: "GET",
      status: 200,
      queueMsProxy: 0,
      totalMs: expect.any(Number),
      bytesOut: expect.any(Number),
      summary: expect.objectContaining({
        "apiTail.request": expect.objectContaining({
          status: expect.objectContaining({ count: 1, sum: 200 }),
          totalMs: expect.objectContaining({ count: 1 }),
          queueMsProxy: expect.objectContaining({ count: 1, sum: 0 }),
          bytesOut: expect.objectContaining({ count: 1 }),
        }),
      }),
    });
    expect(event.summary["apiTail.request"].status.sum).toBe(200);
  });

  it("samples when request is under threshold and sample rate is zero", async () => {
    const appendPerfEvents = vi.fn(async () => ({ accepted: 1 }));
    const app = createApp({
      appendPerfEvents,
      sampleRate: 0,
      slowRequestMs: 500,
    });

    const res = await request(app).get("/api/fast");
    expect(res.status).toBe(200);
    await waitForTelemetryFlush();

    expect(appendPerfEvents).not.toHaveBeenCalled();
  });

  it("captures headers, identifiers, phases, cache flags, and etag hit", async () => {
    const appendPerfEvents = vi.fn(async () => ({ accepted: 1 }));
    const app = createApp({
      appendPerfEvents,
      sampleRate: 1,
      slowRequestMs: 500,
    });

    const res = await request(app)
      .get("/api/etag")
      .set("If-None-Match", '"abc"')
      .set("x-request-id", "req-1")
      .set("x-run-id", "run-7")
      .set("x-source", "dashboard");

    expect(res.status).toBe(304);
    await waitForTelemetryFlush();

    expect(appendPerfEvents).toHaveBeenCalledTimes(1);
    const event = appendPerfEvents.mock.calls[0][0][0];
    expect(event.endpoint).toBe("/api/etag");
    expect(event.requestId).toBe("req-1");
    expect(event.runId).toBe("run-7");
    expect(event.source).toBe("dashboard");
    expect(event.workload).toBe("models");
    expect(event.queueMsProxy).toBe(2);
    expect(event.etagHit).toBe(true);
    expect(event.status).toBe(304);
    expect(event.cacheState).toMatchObject({ state: "miss" });
    expect(event.summary["apiTail.request"].queueMsProxy.sum).toBe(2);
    expect(event.summary["apiTail.request"].etagHit.sum).toBe(1);
    expect(event.summary["apiTail.cache"].cacheMiss.sum).toBe(1);
    expect(event.summary["apiTail.phase.serializeMs"].durationMs.sum).toBe(9);
  });

  it("captures x-hud-run-id header as runId", async () => {
    const appendPerfEvents = vi.fn(async () => ({ accepted: 1 }));
    const app = createApp({
      appendPerfEvents,
      sampleRate: 1,
      slowRequestMs: 500,
    });

    const res = await request(app)
      .get("/api/fast")
      .set("x-hud-run-id", "run-hud-12");

    expect(res.status).toBe(200);
    await waitForTelemetryFlush();

    expect(appendPerfEvents).toHaveBeenCalledTimes(1);
    const event = appendPerfEvents.mock.calls[0][0][0];
    expect(event.runId).toBe("run-hud-12");
  });

  it("captures route phase and workload metadata from /api/models hook", async () => {
    const appendPerfEvents = vi.fn(async () => ({ accepted: 1 }));
    const app = createApp({
      appendPerfEvents,
      sampleRate: 1,
      slowRequestMs: 500,
    });

    const res = await request(app).get("/api/models");
    expect(res.status).toBe(200);
    await waitForTelemetryFlush();

    expect(appendPerfEvents).toHaveBeenCalledTimes(1);
    const event = appendPerfEvents.mock.calls[0][0][0];
    expect(event.workload).toBe("models");
    expect(event.summary["apiTail.cache"].cacheHit.sum).toBe(1);
    expect(event.summary["apiTail.phase.diskReadMs"].durationMs.sum).toBe(11);
  });

  it("normalizes parameterized routes to template form at completion", async () => {
    const appendPerfEvents = vi.fn(async () => ({ accepted: 1 }));
    const app = createApp({
      appendPerfEvents,
      sampleRate: 1,
      slowRequestMs: 500,
    });

    const res = await request(app).get("/api/session-log/agent-123/session-9");
    expect(res.status).toBe(200);
    await waitForTelemetryFlush();

    expect(appendPerfEvents).toHaveBeenCalledTimes(1);
    const event = appendPerfEvents.mock.calls[0][0][0];
    expect(event.endpoint).toBe("/api/session-log/:agentId/:sessionId");
  });

  it("counts bytes for streamed responses across write() and end()", async () => {
    const appendPerfEvents = vi.fn(async () => ({ accepted: 1 }));
    const app = createApp({
      appendPerfEvents,
      sampleRate: 1,
      slowRequestMs: 500,
    });

    const res = await request(app).get("/api/streaming");
    expect(res.status).toBe(200);
    expect(res.text).toBe("hello world");
    await waitForTelemetryFlush();

    expect(appendPerfEvents).toHaveBeenCalledTimes(1);
    const event = appendPerfEvents.mock.calls[0][0][0];
    expect(event.bytesOut).toBe(11);
    expect(event.summary["apiTail.request"].bytesOut.sum).toBe(11);
  });
});
