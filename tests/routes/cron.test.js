import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const helpers = require("../../lib/helpers");
const cronGateway = require("../../lib/gateway-compat/contracts/cron.js");

helpers.OPENCLAW_HOME = "/mock/home";

function createApp() {
  delete require.cache[require.resolve("../../routes/cron")];
  const router = require("../../routes/cron");
  const app = express();
  app.use(router);
  return app;
}

function setGatewayListResult(result) {
  cronGateway.listCronJobs.mockResolvedValue(result);
}

function setGatewayListError(error) {
  cronGateway.listCronJobs.mockRejectedValue(error);
}

function setFallbackJobs(fileContents, configContents = {}) {
  const localHelpers = require("../../lib/helpers");
  vi.spyOn(localHelpers, "safeJSON");
  vi.spyOn(localHelpers, "safeJSON5");
  localHelpers.safeJSON.mockReturnValue(fileContents);
  localHelpers.safeJSON5.mockReturnValue(configContents);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(cronGateway, "listCronJobs");
  vi.spyOn(cronGateway, "addCronJob");
  vi.spyOn(cronGateway, "updateCronJob");
  vi.spyOn(cronGateway, "removeCronJob");
  vi.spyOn(helpers, "stripSecrets").mockImplementation((obj) => obj);
});

describe("GET /api/cron", () => {
  beforeEach(() => {
    cronGateway.listCronJobs.mockResolvedValue({ jobs: [] });
  });

  it("returns canonical list payload from gateway", async () => {
    setGatewayListResult({
      jobs: [{ id: "job-1", name: "Nightly" }],
      total: 1,
      offset: 0,
      limit: 50,
      hasMore: false,
      nextOffset: null,
    });

    const res = await request(createApp()).get("/api/cron");
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].name).toBe("Nightly");
    expect(res.body.meta).toMatchObject({
      gatewayAvailable: true,
      source: "gateway",
    });
    expect(cronGateway.listCronJobs).toHaveBeenCalledWith();
  });

  it("falls back to degraded local read when gateway is unavailable", async () => {
    setGatewayListError({
      code: "UNAVAILABLE",
      status: 503,
      message: "gateway unreachable",
      reason: "network_unreachable",
    });
    setFallbackJobs(
      { jobs: [{ id: "local-1", name: "Local job", payload: {} }], version: 2 },
      { agents: { defaults: { model: { primary: "openai/gpt-4" } } } },
    );

    const res = await request(createApp()).get("/api/cron");
    expect(res.status).toBe(200);
    expect(res.body.jobs[0]).toMatchObject({ id: "local-1", name: "Local job" });
    expect(res.body.meta.gatewayAvailable).toBe(false);
    expect(res.body.meta.diagnostics).toHaveLength(1);
    expect(res.body.meta.diagnostics[0].code).toBe("CRON_LIST_FALLBACK");
    expect(cronGateway.listCronJobs).toHaveBeenCalled();
  });

  it("falls back to degraded local read when gateway list is unavailable due to missing token", async () => {
    setGatewayListError(new Error("Gateway token not configured"));
    setFallbackJobs(
      { jobs: [{ id: "local-token", name: "Local token fallback", payload: {} }], version: 2 },
      { agents: { defaults: { model: { primary: "openai/gpt-4" } } } },
    );

    const res = await request(createApp()).get("/api/cron");
    expect(res.status).toBe(200);
    expect(res.body.jobs[0]).toMatchObject({ id: "local-token", name: "Local token fallback" });
    expect(res.body.meta).toMatchObject({
      gatewayAvailable: false,
      source: "fallback",
      status: "degraded",
    });
    expect(res.body.meta.diagnostics).toHaveLength(1);
    expect(res.body.meta.diagnostics[0].code).toBe("CRON_LIST_FALLBACK");
  });

  it("returns forbidden when local origin is not allowed for read-only endpoint", async () => {
    setGatewayListResult({ jobs: [] });
    const res = await request(createApp())
      .get("/api/cron")
      .set("Origin", "https://attacker.example")
      .send();

    expect(res.status).toBe(200);
    expect(res.body.jobs).toEqual([]);
  });

  it("maps gateway validation failures to bad request", async () => {
    setGatewayListError({
      code: "BAD_REQUEST",
      status: 400,
      message: "invalid request",
      reason: "invalid_request",
    });

    setFallbackJobs({ jobs: [] }, {});
    const res = await request(createApp()).get("/api/cron");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BAD_REQUEST");
    expect(cronGateway.listCronJobs).toHaveBeenCalled();
  });

  it("returns 304 when If-None-Match matches /api/cron ETag", async () => {
    setGatewayListResult({
      jobs: [{ id: "job-1", name: "Nightly" }],
      total: 1,
      offset: 0,
      limit: 50,
      hasMore: false,
      nextOffset: null,
    });

    const first = await request(createApp()).get("/api/cron");
    const etag = first.headers.etag;

    const second = await request(createApp()).get("/api/cron").set("If-None-Match", etag);

    expect(second.status).toBe(304);
    expect(second.body).toEqual({});
  });
});

describe("POST /api/cron", () => {
  it("creates job via cron.add and returns created job", async () => {
    cronGateway.addCronJob.mockResolvedValue({
      ok: true,
      id: "job-new",
      name: "Manual",
    });

    const res = await request(createApp())
      .post("/api/cron")
      .send({
        name: "Manual",
        schedule: { kind: "cron", expr: "0 0 * * *" },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, id: "job-new", name: "Manual" });
    expect(cronGateway.addCronJob).toHaveBeenCalledWith(
      {
        name: "Manual",
        schedule: { kind: "cron", expr: "0 0 * * *" },
      },
      expect.any(Object),
    );
  });

  it("rejects cross-site origin for create", async () => {
    const res = await request(createApp())
      .post("/api/cron")
      .set("Origin", "https://attacker.example")
      .send({ name: "Manual" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Forbidden origin");
    expect(cronGateway.addCronJob).not.toHaveBeenCalled();
  });

  it("returns mapped gateway error codes for add failures", async () => {
    cronGateway.addCronJob.mockRejectedValue({ code: "INVALID_REQUEST", status: 400, message: "bad payload" });

    const res = await request(createApp())
      .post("/api/cron")
      .send({ name: "Manual" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BAD_REQUEST");
  });
});

describe("PUT /api/cron/:jobId", () => {
  it("updates job using cron.update patch shape", async () => {
    cronGateway.updateCronJob.mockResolvedValue({ id: "j1", name: "updated", enabled: false });

    const res = await request(createApp())
      .put("/api/cron/j1")
      .send({
        name: "updated",
        enabled: false,
        sessionTarget: "main",
        payload: { text: "hello", model: "openai/gpt-4" },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, job: { id: "j1", name: "updated", enabled: false } });
    expect(cronGateway.updateCronJob).toHaveBeenCalledWith(
      {
        id: "j1",
        patch: {
          name: "updated",
          enabled: false,
          sessionTarget: "main",
          payload: {
            kind: "systemEvent",
            text: "hello",
            model: "openai/gpt-4",
          },
        },
      },
      expect.any(Object),
    );
  });

  it("accepts explicit patch from request body", async () => {
    cronGateway.updateCronJob.mockResolvedValue({ id: "j1", enabled: false });

    const res = await request(createApp())
      .put("/api/cron/j1")
      .send({
        patch: {
          enabled: false,
        },
      });

    expect(res.status).toBe(200);
    expect(cronGateway.updateCronJob).toHaveBeenCalledWith(
      {
        id: "j1",
        patch: {
          enabled: false,
        },
      },
      expect.any(Object),
    );
  });

  it("rejects invalid job IDs", async () => {
    const res = await request(createApp()).put("/api/cron/bad%20id").send({ enabled: false });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid job ID");
    expect(cronGateway.updateCronJob).not.toHaveBeenCalled();
  });

  it("rejects cross-site origin for update", async () => {
    const res = await request(createApp())
      .put("/api/cron/job1")
      .set("Origin", "https://attacker.example")
      .send({ enabled: true });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Forbidden origin");
    expect(cronGateway.updateCronJob).not.toHaveBeenCalled();
  });

  it("maps unknown cron job id to not found", async () => {
    cronGateway.updateCronJob.mockRejectedValue({
      code: "NOT_FOUND",
      status: 404,
      message: "unknown cron job id",
      reason: "not_found",
    });

    const res = await request(createApp()).put("/api/cron/job-1").send({ enabled: true });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});

describe("DELETE /api/cron/:jobId", () => {
  it("removes job idempotently and preserves 200 when already absent", async () => {
    cronGateway.removeCronJob.mockResolvedValue({ ok: true, removed: false, id: "missing" });

    const res = await request(createApp()).delete("/api/cron/missing");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, removed: false, id: "missing" });
    expect(cronGateway.removeCronJob).toHaveBeenCalledWith(
      "missing",
      expect.any(Object),
    );
  });

  it("returns removed true when deletion succeeds", async () => {
    cronGateway.removeCronJob.mockResolvedValue({ ok: true, removed: true, id: "job1" });

    const res = await request(createApp()).delete("/api/cron/job1");

    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(true);
    expect(res.body.id).toBe("job1");
  });

  it("rejects cross-site origin for delete", async () => {
    const res = await request(createApp())
      .delete("/api/cron/job1")
      .set("Origin", "https://attacker.example");

    expect(res.status).toBe(403);
    expect(cronGateway.removeCronJob).not.toHaveBeenCalled();
  });

  it("maps malformed identifiers", async () => {
    const res = await request(createApp()).delete("/api/cron/bad%20id");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid job ID");
  });
});

describe("POST /api/cron/:jobId/toggle", () => {
  it("toggles by re-reading gateway list and sends inverted patch", async () => {
    cronGateway.listCronJobs.mockResolvedValue({
      jobs: [
        {
          id: "job1",
          enabled: true,
          name: "Daily job",
          schedule: { expr: "* * * * *", tz: "UTC" },
        },
      ],
    });
    cronGateway.updateCronJob.mockResolvedValue({ ok: true, id: "job1", enabled: false });

    const res = await request(createApp()).post("/api/cron/job1/toggle");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, job: { ok: true, id: "job1", enabled: false } });
    expect(cronGateway.listCronJobs).toHaveBeenCalledWith(
      {
        includeDisabled: true,
        limit: 200,
        offset: 0,
        enabled: "all",
        sortBy: "nextRunAtMs",
        sortDir: "asc",
      },
      expect.any(Object),
    );
    expect(cronGateway.updateCronJob).toHaveBeenCalledWith(
      {
        id: "job1",
        patch: {
          enabled: false,
        },
      },
      expect.any(Object),
    );
  });

  it("returns 404 when toggle target is missing", async () => {
    cronGateway.listCronJobs.mockResolvedValue({ jobs: [] });
    const res = await request(createApp()).post("/api/cron/missing/toggle");

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("not found");
    expect(cronGateway.updateCronJob).not.toHaveBeenCalled();
  });

  it("rejects cross-site origin for toggle", async () => {
    const res = await request(createApp())
      .post("/api/cron/job1/toggle")
      .set("Origin", "https://attacker.example");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Forbidden origin");
    expect(cronGateway.listCronJobs).not.toHaveBeenCalled();
  });
});
