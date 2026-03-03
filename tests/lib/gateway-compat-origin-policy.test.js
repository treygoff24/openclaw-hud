import { describe, it, expect, vi } from "vitest";

const { createRequireLocalOrigin, requireLocalOrigin } = await import(
  "../../lib/gateway-compat/origin-policy.js"
);

function makeReq({ origin = null, remoteAddress = "127.0.0.1" } = {}) {
  return {
    headers: origin ? { origin } : {},
    socket: { remoteAddress },
  };
}

function makeRes() {
  const response = {
    statusCode: null,
    body: null,
    status: vi.fn((code) => {
      response.statusCode = code;
      return response;
    }),
    json: vi.fn((payload) => {
      response.body = payload;
      return response;
    }),
  };
  return response;
}

describe("origin-policy", () => {
  it("allows loopback origin requests", () => {
    const req = makeReq({ origin: "http://localhost:3777" });
    const response = makeRes();
    const next = vi.fn();

    requireLocalOrigin(req, response, next);
    expect(next).toHaveBeenCalled();
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });

  it("allows missing origin requests", () => {
    const req = makeReq();
    const response = makeRes();
    const next = vi.fn();

    requireLocalOrigin(req, response, next);
    expect(next).toHaveBeenCalled();
    expect(response.status).not.toHaveBeenCalled();
  });

  it("allows Tailscale origins only from loopback remote address", () => {
    const req = makeReq({
      origin: "https://foo-bar.ts.net",
      remoteAddress: "127.0.0.1",
    });
    const response = makeRes();
    const next = vi.fn();

    requireLocalOrigin(req, response, next);
    expect(next).toHaveBeenCalled();
    expect(response.status).not.toHaveBeenCalled();
  });

  it("blocks non-loopback non-tailscale origins", () => {
    const req = makeReq({ origin: "https://attacker.example" });
    const response = makeRes();
    const next = vi.fn();

    requireLocalOrigin(req, response, next);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({ error: "Forbidden origin" });
    expect(next).not.toHaveBeenCalled();
  });

  it("blocks Tailscale origin when remote address is not loopback", () => {
    const req = makeReq({
      origin: "https://foo-bar.ts.net",
      remoteAddress: "198.51.100.9",
    });
    const response = makeRes();
    const next = vi.fn();

    requireLocalOrigin(req, response, next);
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({ error: "Forbidden origin" });
    expect(next).not.toHaveBeenCalled();
  });

  it("supports custom error messaging for policy violations", () => {
    const middleware = createRequireLocalOrigin({ errorMessage: "Blocked by HUD" });
    const req = makeReq({ origin: "https://attacker.example" });
    const response = makeRes();
    const next = vi.fn();

    middleware(req, response, next);
    expect(response.json).toHaveBeenCalledWith({ error: "Blocked by HUD" });
    expect(response.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
