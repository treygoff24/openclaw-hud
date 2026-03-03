const { resolveGatewayInvokeBaseUrl } = require("../gateway-http");
const { normalizeGatewayError } = require("./error-map");

const DEFAULT_TOOL_INVOKE_TIMEOUT_MS = 30000;

function toTrimmedString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  return typeof value === "string" ? value.trim() : String(value).trim();
}

function parseJSON(text) {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed;
  } catch {
    return null;
  }
}

async function readResponseText(response) {
  if (!response || typeof response.text !== "function") return "";
  try {
    const value = await response.text();
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

async function readGatewayResponse(response) {
  const responseText = await readResponseText(response);
  let parsedBody = parseJSON(responseText);

  if (!parsedBody && response && typeof response.json === "function") {
    try {
      parsedBody = await response.json();
    } catch {
      parsedBody = null;
    }
  }

  return { responseText, parsedBody };
}

function resolveToolInvokeErrorPayload(response, parsedBody, responseText) {
  const error = parsedBody && typeof parsedBody === "object" ? parsedBody.error : undefined;
  const rawCode =
    toTrimmedString(
      error && error.code
        ? error.code
        : parsedBody && typeof parsedBody.code === "string"
          ? parsedBody.code
          : undefined,
    ) || "";
  const rawMessage =
    toTrimmedString(error && error.message)
    || toTrimmedString(typeof error === "string" ? error : "")
    || toTrimmedString(parsedBody && parsedBody.message)
    || toTrimmedString(responseText)
    || `HTTP ${toTrimmedString(response && response.status) || "unknown"}`;

  return {
    code: rawCode || undefined,
    status: response && response.status,
    message: rawMessage || "Unknown gateway error",
  };
}

function normalizeToolInvokeError(payload) {
  const normalized = normalizeGatewayError(payload);
  const message = toTrimmedString(normalized.message) || "Unknown gateway error";
  const status = Number.isInteger(normalized.status) ? normalized.status : 502;
  return {
    code: normalized.code,
    status,
    reason: normalized.reason,
    message,
    rawMessage: message,
    ...(normalized.rawCode ? { rawCode: normalized.rawCode } : {}),
    ...(normalized.rawStatus !== undefined ? { rawStatus: normalized.rawStatus } : {}),
  };
}

function normalizeToolInvokeSuccessPayload(parsedBody) {
  if (!parsedBody || typeof parsedBody !== "object") return {};
  if (parsedBody?.result && typeof parsedBody.result === "object") {
    return parsedBody.result?.details || parsedBody.result;
  }
  if (parsedBody?.details && typeof parsedBody.details === "object") return parsedBody.details;
  return parsedBody;
}

function isToolInvokeErrorResponse(response, parsedBody) {
  return (
    (response && response.ok === false) ||
    !!(parsedBody && typeof parsedBody === "object" && Object.prototype.hasOwnProperty.call(parsedBody, "error"))
  );
}

async function invokeTool({
  gatewayConfig,
  tool,
  args,
  fetchImpl = global.fetch,
  timeoutMs = DEFAULT_TOOL_INVOKE_TIMEOUT_MS,
  fetchOptions = {},
}) {
  if (!gatewayConfig || typeof gatewayConfig !== "object") {
    return Promise.reject(
      normalizeToolInvokeError({
        code: "GATEWAY_CONFIG_MISSING",
        message: "Gateway config is required",
      }),
    );
  }
  if (!gatewayConfig.token) {
    return Promise.reject(
      normalizeToolInvokeError({
        code: "GATEWAY_TOKEN_MISSING",
        message: "Gateway token not configured",
      }),
    );
  }
  if (!tool) {
    return Promise.reject(
      normalizeToolInvokeError({
        code: "GATEWAY_TOOL_MISSING",
        message: "tool is required",
      }),
    );
  }

  try {
    const gatewayInvokeBaseUrl = resolveGatewayInvokeBaseUrl(gatewayConfig);
    const response = await fetchImpl(`${gatewayInvokeBaseUrl}/tools/invoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gatewayConfig.token}`,
      },
      signal: AbortSignal.timeout(Number(timeoutMs) > 0 ? timeoutMs : DEFAULT_TOOL_INVOKE_TIMEOUT_MS),
      body: JSON.stringify({ tool, args }),
      ...(fetchOptions || {}),
    });

    const { responseText, parsedBody } = await readGatewayResponse(response);
    if (isToolInvokeErrorResponse(response, parsedBody)) {
      const payload = resolveToolInvokeErrorPayload(response, parsedBody, responseText);
      const normalized = normalizeToolInvokeError(payload);
      return Promise.reject(normalized);
    }

    return normalizeToolInvokeSuccessPayload(parsedBody);
  } catch (err) {
    const normalized = normalizeToolInvokeError(err);
    return Promise.reject(normalized);
  }
}

module.exports = {
  invokeTool,
  resolveToolInvokeErrorPayload,
  normalizeToolInvokeError,
  normalizeToolInvokeSuccessPayload,
  readGatewayResponse,
  DEFAULT_TOOL_INVOKE_TIMEOUT_MS,
};
