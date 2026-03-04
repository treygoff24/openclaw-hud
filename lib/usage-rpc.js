const { getGatewayConfig } = require("./helpers");
const { getGatewayHost, isLocalLoopbackHost } = require("./gateway-http");
const { callGatewayMethod } = require("./gateway-compat/client");
const {
  normalizeGatewayError,
  TIMEOUT_CODES,
  UNAVAILABLE_CODES,
} = require("./gateway-compat/error-map");

const REQUEST_TIMEOUT_MS = 30000;

function gatewayError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function toUtcDate(value) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function mapSessionsUsageParams(args = {}) {
  const params = {};
  const passthroughKeys = [
    "key",
    "limit",
    "includeContextWeight",
    "startDate",
    "endDate",
    "mode",
    "utcOffset",
  ];
  for (const key of passthroughKeys) {
    if (hasOwn(args, key) && args[key] !== undefined) params[key] = args[key];
  }

  if (!hasOwn(params, "startDate") && hasOwn(args, "from")) {
    const startDate = toUtcDate(args.from);
    if (startDate) params.startDate = startDate;
  }
  if (!hasOwn(params, "endDate") && hasOwn(args, "to")) {
    const endDate = toUtcDate(args.to);
    if (endDate) params.endDate = endDate;
  }
  if (!hasOwn(params, "mode")) params.mode = "utc";

  return params;
}

function isSessionsUsageUnavailable(rawError, method, message) {
  if (method !== "sessions.usage") return false;

  const msg = String(message || "");
  const hasMethodName = /sessions\.usage/i.test(msg);
  const unavailableByMessage =
    /(tool not available|method not found|unknown method|not implemented)/i.test(msg);
  const unavailableByCode = [
    "TOOL_NOT_AVAILABLE",
    "METHOD_NOT_FOUND",
    "UNKNOWN_METHOD",
    "NOT_IMPLEMENTED",
  ].includes(String(rawError?.code || "").toUpperCase());

  return (hasMethodName && unavailableByMessage) || unavailableByCode;
}

function normalizeErrorMessage(rawError) {
  if (rawError == null) return "Unknown gateway error";
  if (typeof rawError.message === "string" && rawError.message.trim())
    return rawError.message.trim();
  if (typeof rawError === "string" && rawError.trim()) return rawError.trim();
  if (typeof rawError?.error === "string" && rawError.error.trim()) return rawError.error.trim();
  if (rawError?.error?.message && String(rawError.error.message).trim()) {
    return String(rawError.error.message).trim();
  }
  return "Unknown gateway error";
}

function isTransportUnreachable(rawError, normalized, message) {
  const rawCode = String(
    rawError?.code || rawError?.error?.code || rawError?.name || normalized?.rawCode || "",
  )
    .trim()
    .toUpperCase();

  if (TIMEOUT_CODES.has(rawCode) || UNAVAILABLE_CODES.has(rawCode)) return true;

  if (normalized?.reason === "timeout" && rawCode) return true;
  if (
    normalized?.reason === "network_unreachable" &&
    rawCode &&
    /^(?:UNAVAILABLE|NETWORK_ERROR)$/.test(rawCode)
  ) {
    return true;
  }

  const msg = String(message || "").toLowerCase();
  return /timeout|timed out|connection timed out|request timed out|connection lost|connection refused|connection reset|gateway unavailable|network (?:error|unavailable)|fetch failed|econnrefused|econnreset|ehostunreach|enotfound|eai_again|temporarily unavailable|service unavailable|gateway not connected|not connected|socket hang up/i.test(
    msg,
  );
}

function createGatewayRequestError(rawError, method) {
  const normalized = normalizeGatewayError(rawError);
  const message = normalized.message || normalizeErrorMessage(rawError);
  const status = Number(normalized.rawStatus);
  const rawCode = normalized.rawCode || rawError?.code || rawError?.error?.code;

  if (isSessionsUsageUnavailable(rawError, method, message)) {
    const err = gatewayError("GATEWAY_SESSIONS_USAGE_UNAVAILABLE", `Gateway error: ${message}`);
    if (Number.isFinite(status) && status > 0) err.status = status;
    if (rawCode) err.gatewayCode = String(rawCode);
    err.gatewayMethod = method;
    return err;
  }

  if (message === "Gateway token not configured") {
    const err = gatewayError("GATEWAY_TOKEN_MISSING", message);
    if (Number.isFinite(status) && status > 0) err.status = status;
    if (rawCode) err.gatewayCode = String(rawCode);
    err.gatewayMethod = method;
    return err;
  }

  if (isTransportUnreachable(rawError, normalized, message)) {
    const err = gatewayError("GATEWAY_UNREACHABLE", `Gateway request failed: ${message}`);
    err.status = Number.isFinite(status) && status > 0 ? status : 503;
    if (rawCode) err.gatewayCode = String(rawCode);
    err.gatewayMethod = method;
    return err;
  }

  const err = gatewayError("GATEWAY_RESPONSE_ERROR", `Gateway error: ${message}`);
  if (Number.isFinite(status) && status > 0) err.status = status;
  if (rawCode) err.gatewayCode = String(rawCode);
  err.gatewayMethod = method;
  return err;
}

async function requestSessionsUsage(args = {}) {
  const gw = getGatewayConfig();
  if (!gw.token) throw gatewayError("GATEWAY_TOKEN_MISSING", "Gateway token not configured");

  const host = getGatewayHost(gw);
  if (!isLocalLoopbackHost(host)) {
    throw gatewayError(
      "GATEWAY_HOST_UNSUPPORTED",
      "Gateway host must be local/loopback for token-authenticated HTTP requests",
    );
  }

  const params = mapSessionsUsageParams(args);

  try {
    const result = await callGatewayMethod("sessions.usage", params, {
      gatewayConfig: gw,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
    });
    return { ok: true, result };
  } catch (error) {
    throw createGatewayRequestError(error, "sessions.usage");
  }
}

module.exports = { requestSessionsUsage };
