// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";

const helpers = require("../../lib/helpers");
const compatClient = require("../../lib/gateway-compat/client");

function loadModule() {
  delete require.cache[require.resolve("../../lib/usage-rpc")];
  return require("../../lib/usage-rpc");
}

describe("usage-rpc", () => {
  const originalGetGatewayConfig = helpers.getGatewayConfig;

  afterEach(async () => {
    helpers.getGatewayConfig = originalGetGatewayConfig;
    vi.restoreAllMocks();
  });

  it("throws when gateway token is missing", async () => {
    helpers.getGatewayConfig = vi.fn(() => ({ host: "127.0.0.1", port: 18789, token: "" }));
    const { requestSessionsUsage } = loadModule();

    await expect(requestSessionsUsage({ from: 1, to: 2 })).rejects.toMatchObject({
      code: "GATEWAY_TOKEN_MISSING",
    });
  });

  it("fails closed when gateway host is not local", async () => {
    helpers.getGatewayConfig = vi.fn(() => ({ host: "198.51.100.10", port: 18789, token: "t" }));
    const { requestSessionsUsage } = loadModule();

    await expect(requestSessionsUsage({ from: 1, to: 2 })).rejects.toMatchObject({
      code: "GATEWAY_HOST_UNSUPPORTED",
    });
  });

  it("delegates sessions.usage lookup to compatibility client", async () => {
    vi.spyOn(compatClient, "callGatewayMethod").mockResolvedValue({
      sessions: [{ id: "abc" }],
    });

    helpers.getGatewayConfig = vi.fn(() => ({
      host: "127.0.0.1",
      port: 18789,
      token: "test-token",
    }));

    const { requestSessionsUsage } = loadModule();
    const result = await requestSessionsUsage({
      from: "2026-02-25T00:00:00.000Z",
      to: "2026-02-25T23:59:59.000Z",
      limit: 5,
      key: "agent-id",
      includeContextWeight: true,
      utcOffset: -360,
      mode: "local",
    });

    expect(result).toEqual({
      ok: true,
      result: {
        sessions: [{ id: "abc" }],
      },
    });

    expect(compatClient.callGatewayMethod).toHaveBeenCalledTimes(1);
    expect(compatClient.callGatewayMethod).toHaveBeenCalledWith(
      "sessions.usage",
      expect.objectContaining({
        key: "agent-id",
        limit: 5,
        includeContextWeight: true,
        utcOffset: -360,
        startDate: "2026-02-25",
        endDate: "2026-02-25",
        mode: "local",
      }),
      expect.objectContaining({
        gatewayConfig: { host: "127.0.0.1", port: 18789, token: "test-token" },
      }),
    );
  });

  it("maps unavailable sessions.usage method errors", async () => {
    vi.spyOn(compatClient, "callGatewayMethod").mockRejectedValue(
      Object.assign(new Error("Tool not available: sessions.usage"), {
        code: "METHOD_NOT_FOUND",
        status: 404,
      }),
    );

    helpers.getGatewayConfig = vi.fn(() => ({
      host: "127.0.0.1",
      port: 18789,
      token: "test-token",
    }));
    const { requestSessionsUsage } = loadModule();

    await expect(requestSessionsUsage({ from: 1, to: 2 })).rejects.toMatchObject({
      code: "GATEWAY_SESSIONS_USAGE_UNAVAILABLE",
      status: 404,
      gatewayCode: "METHOD_NOT_FOUND",
    });
  });

  it("maps unreachable gateway transport errors", async () => {
    vi.spyOn(compatClient, "callGatewayMethod").mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:18789"), {
        code: "ECONNREFUSED",
      }),
    );

    helpers.getGatewayConfig = vi.fn(() => ({
      host: "127.0.0.1",
      port: 18789,
      token: "test-token",
    }));
    const { requestSessionsUsage } = loadModule();

    await expect(requestSessionsUsage({ from: 1, to: 2 })).rejects.toMatchObject({
      code: "GATEWAY_UNREACHABLE",
      gatewayCode: "ECONNREFUSED",
    });
  });

  it("preserves generic gateway response errors", async () => {
    vi.spyOn(compatClient, "callGatewayMethod").mockRejectedValue(
      new Error("Gateway rejected request"),
    );

    helpers.getGatewayConfig = vi.fn(() => ({
      host: "127.0.0.1",
      port: 18789,
      token: "test-token",
    }));
    const { requestSessionsUsage } = loadModule();

    await expect(requestSessionsUsage({ from: 1, to: 2 })).rejects.toMatchObject({
      code: "GATEWAY_RESPONSE_ERROR",
    });
  });

  it("treats 0.0.0.0 host as loopback and connects safely", async () => {
    vi.spyOn(compatClient, "callGatewayMethod").mockResolvedValue({ sessions: [{ id: "abc" }] });

    helpers.getGatewayConfig = vi.fn(() => ({ host: "0.0.0.0", port: 18789, token: "test-token" }));
    const { requestSessionsUsage } = loadModule();

    const result = await requestSessionsUsage({ from: 1, to: 2 });
    expect(result).toEqual({ ok: true, result: { sessions: [{ id: "abc" }] } });
  });
});
