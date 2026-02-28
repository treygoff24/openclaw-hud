import { describe, it, expect } from "vitest";

const {
  validateWsUpgradeRequest,
  isLoopbackOrigin,
  isLoopbackRemoteAddress,
  isTailscaleOrigin,
} = require("../../lib/ws-origin-guard");

function makeReq({ origin, remoteAddress = "127.0.0.1", url = "/ws", headers = {} } = {}) {
  return {
    url,
    headers: {
      ...(origin ? { origin } : {}),
      ...headers,
    },
    socket: {
      remoteAddress,
    },
  };
}

describe("ws-origin-guard", () => {
  it("recognizes loopback origins", () => {
    expect(isLoopbackOrigin("http://localhost:3777")).toBe(true);
    expect(isLoopbackOrigin("http://127.0.0.1:3777")).toBe(true);
    expect(isLoopbackOrigin("https://[::1]:3777")).toBe(true);
    expect(isLoopbackOrigin("https://example.com")).toBe(false);
  });

  it("recognizes loopback remote addresses", () => {
    expect(isLoopbackRemoteAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackRemoteAddress("::1")).toBe(true);
    expect(isLoopbackRemoteAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackRemoteAddress("10.0.0.5")).toBe(false);
  });

  it("allows upgrade for loopback origin", () => {
    const result = validateWsUpgradeRequest(makeReq({ origin: "http://localhost:3777" }));
    expect(result.ok).toBe(true);
  });

  it("allows upgrade for no-origin loopback client", () => {
    const result = validateWsUpgradeRequest(makeReq({ origin: "", remoteAddress: "127.0.0.1" }));
    expect(result.ok).toBe(true);
  });

  it("rejects loopback-origin requests from non-loopback remote address", () => {
    const result = validateWsUpgradeRequest(
      makeReq({ origin: "http://localhost:3777", remoteAddress: "198.51.100.12" }),
    );
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("rejects cross-site origin without auth token", () => {
    const result = validateWsUpgradeRequest(
      makeReq({ origin: "https://attacker.example", remoteAddress: "127.0.0.1" }),
    );
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("recognizes tailscale origins", () => {
    expect(isTailscaleOrigin("https://myhost.tail94f8e5.ts.net")).toBe(true);
    expect(isTailscaleOrigin("https://foo.ts.net")).toBe(true);
    expect(isTailscaleOrigin("http://foo.ts.net")).toBe(false);
    expect(isTailscaleOrigin("https://evil-ts.net")).toBe(false);
    expect(isTailscaleOrigin("https://attacker.example")).toBe(false);
  });

  it("allows tailscale origin from loopback (tailscale serve proxy)", () => {
    const result = validateWsUpgradeRequest(
      makeReq({ origin: "https://macbook.tail94f8e5.ts.net", remoteAddress: "127.0.0.1" }),
    );
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("tailscale-loopback");
  });

  it("rejects tailscale origin from non-loopback address", () => {
    const result = validateWsUpgradeRequest(
      makeReq({ origin: "https://macbook.tail94f8e5.ts.net", remoteAddress: "198.51.100.12" }),
    );
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("does not trust query token parameter for ws auth", () => {
    const goodTokenResult = validateWsUpgradeRequest(
      makeReq({
        origin: "https://attacker.example",
        remoteAddress: "127.0.0.1",
        url: "/ws?wsAuth=shared-token",
      }),
      { authToken: "shared-token" },
    );
    expect(goodTokenResult.ok).toBe(false);
    expect(goodTokenResult.statusCode).toBe(403);
  });

  it("allows cross-site request only with matching ws auth header", () => {
    const goodTokenResult = validateWsUpgradeRequest(
      makeReq({
        origin: "https://attacker.example",
        remoteAddress: "198.51.100.12",
        headers: {
          "x-hud-ws-auth": "shared-token",
        },
      }),
      { authToken: "shared-token" },
    );
    expect(goodTokenResult.ok).toBe(true);
    expect(goodTokenResult.reason).toBe("auth-token");
  });

  it("rejects cross-site request when ws auth header token is wrong", () => {
    const badTokenResult = validateWsUpgradeRequest(
      makeReq({
        origin: "https://attacker.example",
        remoteAddress: "198.51.100.12",
        headers: {
          "x-hud-ws-auth": "wrong-token",
        },
      }),
      { authToken: "shared-token" },
    );
    expect(badTokenResult.ok).toBe(false);
    expect(badTokenResult.statusCode).toBe(403);
  });
});
