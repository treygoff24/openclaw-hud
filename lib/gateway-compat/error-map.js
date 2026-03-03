const TIMEOUT_CODES = Object.freeze(new Set([
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "TIMEOUT",
  "ERR_TIMEOUT",
  "ABORT_ERR",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]));

const FORBIDDEN_CODES = Object.freeze(new Set(["FORBIDDEN", "UNAUTHORIZED", "PERMISSION_DENIED", "AUTH_FAILED"]));

const SCOPE_WARNING_CODES = Object.freeze(
  new Set(["INVALID_SCOPE", "MISSING_SCOPE", "AUTH_SCOPE_MISSING", "INSUFFICIENT_SCOPE"]),
);

const UNAVAILABLE_CODES = Object.freeze(
  new Set([
    "UNAVAILABLE",
    "ENOTFOUND",
    "ECONNRESET",
    "ECONNREFUSED",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "EAI_AGAIN",
    "ERR_NETWORK",
    "NETWORK_ERROR",
  ]),
);

function normalizeRawCode(rawCode) {
  if (typeof rawCode !== "string") return "";
  return rawCode.trim().toUpperCase();
}

function normalizeRawStatus(err) {
  const candidates = [err && err.status, err && err.statusCode, err?.response?.status];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === "string") {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function normalizeRawMessage(err) {
  if (typeof err?.message === "string" && err.message.trim()) return err.message.trim();
  if (typeof err === "string" && err.trim()) return err.trim();
  if (err && typeof err.error === "string" && err.error.trim()) return err.error.trim();
  if (err && err.error && typeof err.error.message === "string" && err.error.message.trim()) {
    return err.error.message.trim();
  }
  return "Unknown gateway error";
}

function isMessageMatch(message, pattern) {
  if (!message) return false;
  return pattern.test(message);
}

function classifyGatewayError(err, _options = {}) {
  const rawCode = normalizeRawCode(err?.code || err?.error?.code || err?.name);
  const rawStatus = normalizeRawStatus(err);
  const rawMessage = normalizeRawMessage(err);
  const messageLower = rawMessage.toLowerCase();

  if (rawStatus === 401 || rawStatus === 403 || rawStatus === 404) {
    if (rawStatus === 404) {
      return {
        code: "NOT_FOUND",
        status: 404,
        reason: "not_found",
      };
    }
    if (rawStatus === 401 || rawStatus === 403) {
      return {
        code: "FORBIDDEN",
        status: 403,
        reason: "forbidden",
      };
    }
  }

  if (
    rawCode === "INVALID_REQUEST" &&
    (rawMessage && /missing scope|unauthorized role/.test(messageLower))
  ) {
    return {
      code: "FORBIDDEN",
      status: 403,
      reason: "missing_scope",
    };
  }

  if (
    rawCode === "INVALID_REQUEST" &&
    /unknown cron job id|unknown session|session not found|invalid session key|not found/.test(messageLower)
  ) {
    return {
      code: "NOT_FOUND",
      status: 404,
      reason: "not_found",
    };
  }

  if (
    rawCode === "INVALID_REQUEST" ||
    (rawStatus && rawStatus >= 400 && rawStatus < 500) ||
    /invalid request/.test(messageLower)
  ) {
    return {
      code: "BAD_REQUEST",
      status: 400,
      reason: "invalid_request",
    };
  }

  if (
    FORBIDDEN_CODES.has(rawCode) ||
    SCOPE_WARNING_CODES.has(rawCode) ||
    /missing scope|unauthorized|forbidden|permission denied|access denied/.test(messageLower)
  ) {
    return {
      code: "FORBIDDEN",
      status: 403,
      reason: "forbidden",
    };
  }

  if (
    TIMEOUT_CODES.has(rawCode) ||
    /timeout|timed out|deadline exceeded|operation was aborted/.test(messageLower)
  ) {
    return {
      code: "UNAVAILABLE",
      status: 503,
      reason: "timeout",
    };
  }

  if (
    UNAVAILABLE_CODES.has(rawCode) ||
    rawStatus >= 500 ||
    /service unavailable|temporarily unavailable|bad gateway|gateway unavailable|network error|socket hang up|connection refused|fetch failed|econnrefused|enotfound|eai_again|gateway not connected/.test(
      messageLower,
    )
  ) {
    return {
      code: "UNAVAILABLE",
      status: 503,
      reason: "network_unreachable",
    };
  }

  return {
    code: "GATEWAY_ERROR",
    status: 502,
    reason: "gateway_error",
  };
}

function normalizeGatewayError(err, options = {}) {
  const rawCode = normalizeRawCode(err?.code || err?.error?.code || err?.name);
  const rawMessage = normalizeRawMessage(err);
  const rawStatus = normalizeRawStatus(err);
  const normalized = classifyGatewayError(err, options);
  return {
    ...normalized,
    message: rawMessage,
    ...(rawCode ? { rawCode } : {}),
    ...(rawStatus !== undefined ? { rawStatus } : {}),
  };
}

module.exports = {
  TIMEOUT_CODES,
  FORBIDDEN_CODES,
  SCOPE_WARNING_CODES,
  UNAVAILABLE_CODES,
  mapGatewayError: normalizeGatewayError,
  normalizeGatewayError,
  classifyGatewayError,
};
