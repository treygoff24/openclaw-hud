import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGatewayState = {
  instances: [],
};

class MockGatewayWS {
  constructor(options) {
    this.options = options;
    this.connected = false;
    this.connect = vi.fn(async () => {
      this.connected = true;
    });
    this.request = vi.fn(async (method, params) => ({
      method,
      params,
      ok: true,
    }));
    this.close = vi.fn(() => {
      this.connected = false;
    });
    mockGatewayState.instances.push(this);
  }
}

const {
  callGatewayMethod,
  resolveMethodScopes,
  createGatewayClient,
  METHOD_SCOPE_MAP,
  DEFAULT_CONNECT_SCOPES,
} = await import("../../lib/gateway-compat/client.js");

const gatewayConfig = {
  host: "127.0.0.1",
  port: 18789,
  token: "test-token",
};

function makeReqPayload() {
  return { sessionKey: "agent:agent1:main" };
}

beforeEach(() => {
  mockGatewayState.instances.length = 0;
  vi.clearAllMocks();
});

describe("gateway compat client", () => {
  it("resolves method scope from built-in map", () => {
    expect(resolveMethodScopes("cron.add")).toEqual(["operator.admin"]);
    expect(resolveMethodScopes("cron.list")).toEqual(["operator.read"]);
    expect(resolveMethodScopes("chat.send")).toEqual(["operator.write"]);
  });

  it("falls back to default connect scopes when method is unknown", () => {
    expect(resolveMethodScopes("unknown.method")).toEqual(DEFAULT_CONNECT_SCOPES);
    expect(resolveMethodScopes(undefined)).toEqual(DEFAULT_CONNECT_SCOPES);
  });

  it("uses scope-aware invocation when creating a new GatewayWS client", async () => {
    const payload = makeReqPayload();
    const result = await callGatewayMethod("cron.add", payload, {
      gatewayConfig,
      GatewayWSClass: MockGatewayWS,
      autoClose: false,
    });

    expect(result).toEqual({ ok: true, method: "cron.add", params: payload });
    expect(mockGatewayState.instances).toHaveLength(1);
    const client = mockGatewayState.instances[0];
    expect(client.options.connect.scopes).toEqual(METHOD_SCOPE_MAP["cron.add"]);
    expect(typeof client.options.connect.scopes === "string").toBe(false);
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith("cron.add", payload);
  });

  it("passes custom scope map from options", async () => {
    const customMap = {
      ...METHOD_SCOPE_MAP,
      "cron.add": ["operator.write", "operator.admin"],
    };

    await callGatewayMethod("cron.add", makeReqPayload(), {
      gatewayConfig,
      methodScopeMap: customMap,
      GatewayWSClass: MockGatewayWS,
      autoClose: false,
    });

    const client = mockGatewayState.instances[0];
    expect(client.options.connect.scopes).toEqual(customMap["cron.add"]);
  });

  it("reuses provided gateway client without creating a new one", async () => {
    const providedClient = {
      connected: false,
      connect: vi.fn(async () => {
        providedClient.connected = true;
      }),
      request: vi.fn(async (method, params) => ({ from: "provided", method, params })),
      options: { provided: true },
    };

    const payload = { message: "hello" };
    const result = await callGatewayMethod("chat.send", payload, {
      client: providedClient,
      connectScopes: ["operator.write"],
    });

    expect(mockGatewayState.instances).toHaveLength(0);
    expect(providedClient.connect).toHaveBeenCalledTimes(1);
    expect(providedClient.request).toHaveBeenCalledWith("chat.send", payload);
    expect(result).toEqual({ from: "provided", method: "chat.send", params: payload });
  });

  it("creates websocket URL from gateway config host/port", () => {
    const client = createGatewayClient({
      method: "cron.list",
      gatewayConfig,
      methodScopeMap: METHOD_SCOPE_MAP,
      GatewayWSClass: MockGatewayWS,
    });
    expect(client.options.url).toMatch("ws://127.0.0.1:18789");
  });
});
