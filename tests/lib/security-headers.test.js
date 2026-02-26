import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";

const { applySecurityHeaders, buildCsp } = require("../../lib/security-headers");

function createApp() {
  const app = express();
  app.use(applySecurityHeaders());
  app.get("/ok", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("security headers middleware", () => {
  it("sets baseline security headers", async () => {
    const res = await request(createApp()).get("/ok");

    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toBeDefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["permissions-policy"]).toContain("camera=()");
    expect(res.headers["x-permitted-cross-domain-policies"]).toBe("none");
  });

  it("builds a CSP compatible with current app behavior", () => {
    const csp = buildCsp();

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net");
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com data:");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("connect-src 'self' ws: wss:");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });
});
