import { describe, it, expect } from "vitest";

const { normalizeGatewayError } = await import("../../lib/gateway-compat/error-map.js");

describe("gateway-compat error-map", () => {
  it("maps invalid request missing scope to FORBIDDEN with 403", () => {
    const result = normalizeGatewayError({
      code: "INVALID_REQUEST",
      message: "missing scope operator.admin",
    });

    expect(result).toEqual({
      code: "FORBIDDEN",
      status: 403,
      reason: "missing_scope",
      message: "missing scope operator.admin",
      rawCode: "INVALID_REQUEST",
    });
  });

  it("maps unknown cron job ids to NOT_FOUND with 404", () => {
    const result = normalizeGatewayError({
      code: "INVALID_REQUEST",
      message: "unknown cron job id",
    });

    expect(result).toEqual({
      code: "NOT_FOUND",
      status: 404,
      reason: "not_found",
      message: "unknown cron job id",
      rawCode: "INVALID_REQUEST",
    });
  });

  it("maps generic invalid request to BAD_REQUEST with 400", () => {
    const result = normalizeGatewayError({ code: "INVALID_REQUEST", message: "payload missing field" });
    expect(result.status).toBe(400);
    expect(result.code).toBe("BAD_REQUEST");
    expect(result.reason).toBe("invalid_request");
  });

  it("maps explicit UNAVAILABLE and transport-level failures to UNAVAILABLE 503", () => {
    const gatewayUnavailable = normalizeGatewayError({ code: "UNAVAILABLE", message: "service offline" });
    const connRefused = normalizeGatewayError({ code: "ECONNREFUSED", message: "connect refused" });
    const timeoutCode = normalizeGatewayError({ code: "ETIMEDOUT", message: "timed out" });

    expect(gatewayUnavailable).toEqual({
      code: "UNAVAILABLE",
      status: 503,
      reason: "network_unreachable",
      message: "service offline",
      rawCode: "UNAVAILABLE",
    });
    expect(connRefused.code).toBe("UNAVAILABLE");
    expect(connRefused.status).toBe(503);
    expect(connRefused.reason).toBe("network_unreachable");
    expect(timeoutCode.code).toBe("UNAVAILABLE");
    expect(timeoutCode.reason).toBe("timeout");
    expect(timeoutCode.status).toBe(503);
  });

  it("maps unclassified errors to GATEWAY_ERROR with 502", () => {
    const result = normalizeGatewayError({ code: "MYSTERY", message: "weird gateway state" });
    expect(result).toEqual({
      code: "GATEWAY_ERROR",
      status: 502,
      reason: "gateway_error",
      message: "weird gateway state",
      rawCode: "MYSTERY",
    });
  });
});
