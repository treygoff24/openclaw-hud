// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const cronContract = require("../../lib/gateway-compat/contracts/cron.js");

function mockGatewayClient(response) {
  return {
    connected: true,
    close: vi.fn(),
    connect: vi.fn(),
    request: vi.fn().mockResolvedValue(response),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("cron contract list", () => {
  it("builds canonical list params with defaults", () => {
    expect(cronContract.buildCronListParams()).toEqual({
      includeDisabled: true,
      limit: 50,
      offset: 0,
      enabled: "all",
      sortBy: "nextRunAtMs",
      sortDir: "asc",
    });
  });

  it("honors partial list params while keeping canonical defaults", () => {
    const params = cronContract.buildCronListParams({
      query: "nightly",
      enabled: false,
      limit: 25,
    });

    expect(params).toEqual({
      includeDisabled: true,
      limit: 25,
      offset: 0,
      enabled: false,
      sortBy: "nextRunAtMs",
      sortDir: "asc",
      query: "nightly",
    });
  });

  it("normalizes cron list payload from canonical page shapes", () => {
    expect(
      cronContract.normalizeCronListPayload({
        jobs: [{ id: "j1" }],
        total: 1,
        offset: 0,
        limit: 25,
        hasMore: false,
        nextOffset: null,
      }),
    ).toEqual({
      jobs: [{ id: "j1" }],
      total: 1,
      offset: 0,
      limit: 25,
      hasMore: false,
      nextOffset: null,
      meta: { source: "gateway" },
    });
  });

  it("falls back to empty jobs when list payload is malformed", () => {
    expect(cronContract.normalizeCronListPayload(null)).toEqual({
      jobs: [],
      total: 0,
      offset: 0,
      limit: 50,
      hasMore: false,
      nextOffset: null,
      meta: { source: "gateway" },
    });
  });

  it("calls cron.list with canonical params", async () => {
    const client = mockGatewayClient({ jobs: [] });
    const result = await cronContract.listCronJobs(
      { query: "backup" },
      { client, connectScopes: ["operator.read"] },
    );

    expect(client.request).toHaveBeenCalledWith(
      "cron.list",
      {
        includeDisabled: true,
        limit: 50,
        offset: 0,
        enabled: "all",
        sortBy: "nextRunAtMs",
        sortDir: "asc",
        query: "backup",
      },
    );
    expect(result).toEqual({ jobs: [] });
  });
});

describe("cron contract mutations", () => {
  it("normalizes legacy update payload into patch payload", () => {
    expect(
      cronContract.buildCronPatchFromLegacyBody({
        name: "Nightly cleanup",
        enabled: false,
        sessionTarget: "main",
        payload: {
          text: "run task",
        },
      }),
    ).toEqual({
      name: "Nightly cleanup",
      enabled: false,
      sessionTarget: "main",
      payload: {
        kind: "systemEvent",
        text: "run task",
      },
    });
  });

  it("maps jobId alias to id for cron.update", async () => {
    const client = mockGatewayClient({ id: "j1" });
    const result = await cronContract.updateCronJob(
      {
        jobId: "j1",
        patch: {
          enabled: true,
        },
      },
      { client },
    );

    expect(client.request).toHaveBeenCalledWith(
      "cron.update",
      {
        id: "j1",
        patch: {
          enabled: true,
        },
      },
    );
    expect(result).toEqual({ id: "j1" });
  });

  it("normalizes legacy update fields into patch contract payload", async () => {
    const client = mockGatewayClient({ id: "j1" });
    await cronContract.updateCronJob(
      {
        id: "j1",
        name: "Manual",
        enabled: true,
        sessionTarget: "isolated",
        payload: {
          message: "go",
        },
      },
      { client },
    );

    expect(client.request).toHaveBeenCalledWith(
      "cron.update",
      {
        id: "j1",
        patch: {
          name: "Manual",
          enabled: true,
          sessionTarget: "isolated",
          payload: {
            kind: "agentTurn",
            message: "go",
          },
        },
      },
    );
  });

  it("calls cron.add with canonical payload", async () => {
    const client = mockGatewayClient({ id: "new-id", name: "Nightly" });
    await cronContract.addCronJob(
      {
        id: "new-id",
        name: "Nightly",
        schedule: {
          kind: "cron",
          expr: "0 0 * * *",
        },
      },
      { client },
    );

    expect(client.request).toHaveBeenCalledWith(
      "cron.add",
      {
        id: "new-id",
        name: "Nightly",
        schedule: {
          kind: "cron",
          expr: "0 0 * * *",
        },
      },
    );
  });

  it("calls cron.remove with canonical id", async () => {
    const client = mockGatewayClient({ ok: true, removed: true });
    await cronContract.removeCronJob("j1", { client });

    expect(client.request).toHaveBeenCalledWith("cron.remove", { id: "j1" });
  });
});
