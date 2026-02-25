const { getGatewayConfig } = require("../../lib/helpers");
const { chatSubscriptions, clientChatSubs } = require("./state");
const { isCanonicalSessionKey } = require("./session-key");
const {
  validateAttachments,
  buildContentBlocks,
  checkAttachmentRateLimit,
} = require("./attachments");
const {
  normalizeHistoryLimit,
  logHistory,
  loadLocalHistory,
  normalizeGatewayError,
  adaptChatHistoryGatewayError,
  isChatHistoryFallbackEligible,
} = require("./history");
const { isChatMessage, dispatchChatMessage } = require("./dispatcher");

function sendJson(ws, payload) {
  ws.send(JSON.stringify(payload));
}

function formatGatewayHost(host) {
  const normalized = String(host || "").trim();
  if (!normalized || normalized.toLowerCase() === "loopback") return "127.0.0.1";
  if (normalized.includes(":") && !normalized.startsWith("[")) return `[${normalized}]`;
  return normalized;
}

let historyCorrelationSeq = 0;
function nextHistoryCorrelationId() {
  historyCorrelationSeq += 1;
  return `history-${historyCorrelationSeq}`;
}

async function invokeGatewayTool(tool, args) {
  const gwConfig = getGatewayConfig();
  if (!gwConfig.token) throw new Error("Gateway token not configured");
  const host = formatGatewayHost(gwConfig.host || gwConfig.bind || "127.0.0.1");
  const res = await fetch(`http://${host}:${gwConfig.port || 18789}/tools/invoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${gwConfig.token}`,
    },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ tool, args }),
  });

  const body = await res.json();
  if (!res.ok || body?.ok === false) {
    const msg = body?.error?.message || body?.error || `HTTP ${res.status}`;
    throw new Error(String(msg || "Gateway request failed"));
  }
  return body?.result?.details || {};
}

const commandHandlers = {
  "chat-subscribe": async (msg, { ws }) => {
    const { sessionKey } = msg;
    if (!isCanonicalSessionKey(sessionKey)) {
      sendJson(ws, {
        type: "error",
        error: { code: "INVALID_SESSION_KEY", message: "canonical sessionKey required" },
      });
      return;
    }
    if (!chatSubscriptions.has(sessionKey)) chatSubscriptions.set(sessionKey, new Set());
    chatSubscriptions.get(sessionKey).add(ws);
    if (!clientChatSubs.has(ws)) clientChatSubs.set(ws, new Set());
    clientChatSubs.get(ws).add(sessionKey);
    sendJson(ws, { type: "chat-subscribe-ack", sessionKey });
  },

  "chat-unsubscribe": async (msg, { ws }) => {
    const { sessionKey } = msg;
    chatSubscriptions.get(sessionKey)?.delete(ws);
    clientChatSubs.get(ws)?.delete(sessionKey);
  },

  "chat-send": async (msg, { ws, gatewayWS }) => {
    const { sessionKey, message, idempotencyKey, attachments } = msg;
    if (!isCanonicalSessionKey(sessionKey)) {
      sendJson(ws, {
        type: "chat-send-ack",
        idempotencyKey,
        ok: false,
        error: { code: "INVALID_SESSION_KEY", message: "canonical sessionKey required" },
      });
      return;
    }

    if (
      typeof message !== "string" &&
      (!attachments || !Array.isArray(attachments) || attachments.length === 0)
    ) {
      sendJson(ws, {
        type: "chat-send-ack",
        idempotencyKey,
        ok: false,
        error: { code: "INVALID", message: "message or attachments required" },
      });
      return;
    }

    if (attachments && Array.isArray(attachments)) {
      const validationError = validateAttachments(attachments);
      if (validationError) {
        sendJson(ws, { type: "chat-send-ack", idempotencyKey, ok: false, error: validationError });
        return;
      }

      const rateLimitResult = checkAttachmentRateLimit(ws);
      if (!rateLimitResult.allowed) {
        sendJson(ws, {
          type: "chat-send-ack",
          idempotencyKey,
          ok: false,
          error: rateLimitResult.error,
        });
        return;
      }
    }

    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
    const textMessage = typeof message === "string" ? message : "";

    if (gatewayWS && gatewayWS.connected) {
      try {
        const content = buildContentBlocks(message, attachments);
        const result = await gatewayWS.request("chat.send", {
          sessionKey,
          content,
          idempotencyKey,
        });
        sendJson(ws, {
          type: "chat-send-ack",
          idempotencyKey,
          runId: result.runId,
          status: result.status,
          ok: true,
        });
        return;
      } catch (err) {
        if (hasAttachments) {
          sendJson(ws, {
            type: "chat-send-ack",
            idempotencyKey,
            ok: false,
            error: normalizeGatewayError(err),
          });
          return;
        }
      }
    }

    if (hasAttachments) {
      sendJson(ws, {
        type: "chat-send-ack",
        idempotencyKey,
        ok: false,
        error: { code: "UNAVAILABLE", message: "Gateway not connected for attachment send" },
      });
      return;
    }

    try {
      const result = await invokeGatewayTool("sessions_send", { sessionKey, message: textMessage });
      if (result?.status === "error") {
        sendJson(ws, {
          type: "chat-send-ack",
          idempotencyKey,
          ok: false,
          error: { code: "GATEWAY_ERROR", message: result.error || "Gateway send failed" },
        });
        return;
      }
      sendJson(ws, {
        type: "chat-send-ack",
        idempotencyKey,
        runId: result.runId,
        status: result.status || "ok",
        ok: true,
      });
    } catch (err) {
      sendJson(ws, {
        type: "chat-send-ack",
        idempotencyKey,
        ok: false,
        error: { code: "UNAVAILABLE", message: err.message || "Gateway not connected" },
      });
    }
  },

  "chat-history": async (msg, { ws, gatewayWS }) => {
    const { sessionKey, limit } = msg;
    if (!isCanonicalSessionKey(sessionKey)) {
      sendJson(ws, {
        type: "chat-history-result",
        sessionKey: sessionKey || "",
        messages: [],
        error: { code: "INVALID_SESSION_KEY", message: "canonical sessionKey required" },
      });
      return;
    }

    const normalizedLimit = normalizeHistoryLimit(limit);
    const correlationId = nextHistoryCorrelationId();
    logHistory("request", { sessionKey, correlationId, limit: normalizedLimit || "default" });

    let gatewayError = null;
    let shouldFallback = false;
    if (gatewayWS && gatewayWS.connected) {
      logHistory("gateway-attempt", { sessionKey, correlationId });
      try {
        const result = await gatewayWS.request("chat.history", {
          sessionKey,
          ...(normalizedLimit ? { limit: normalizedLimit } : {}),
        });
        const messages = result.messages || [];
        sendJson(ws, {
          type: "chat-history-result",
          sessionKey,
          messages,
          thinkingLevel: result.thinkingLevel,
          verboseLevel: result.verboseLevel,
        });
        logHistory("gateway-success", { sessionKey, correlationId, count: messages.length });
        return;
      } catch (err) {
        gatewayError = adaptChatHistoryGatewayError(err);
        shouldFallback = isChatHistoryFallbackEligible(gatewayError);
        logHistory("gateway-fail", {
          sessionKey,
          correlationId,
          code: gatewayError.code,
          rawCode: gatewayError.rawCode,
          rawStatus: gatewayError.rawStatus,
          fallbackReason: gatewayError.reason,
          fallbackEligible: shouldFallback,
        });
      }
    } else {
      gatewayError = adaptChatHistoryGatewayError({
        code: "UNAVAILABLE",
        message: "Gateway not connected",
      });
      shouldFallback = isChatHistoryFallbackEligible(gatewayError);
      logHistory("gateway-unavailable", {
        sessionKey,
        correlationId,
        fallbackReason: gatewayError.reason,
        fallbackEligible: shouldFallback,
      });
    }

    if (!shouldFallback) {
      sendJson(ws, { type: "chat-history-result", sessionKey, messages: [], error: gatewayError });
      logHistory("fallback-skipped", {
        sessionKey,
        correlationId,
        code: gatewayError?.code || "UNKNOWN",
        fallbackReason: gatewayError?.reason || "unknown",
      });
      return;
    }

    try {
      const fallbackMessages = loadLocalHistory(sessionKey, normalizedLimit);
      sendJson(ws, { type: "chat-history-result", sessionKey, messages: fallbackMessages });
      logHistory("fallback-success", {
        sessionKey,
        correlationId,
        count: fallbackMessages.length,
        fallbackReason: gatewayError?.reason || "unavailable",
      });
    } catch (fallbackErr) {
      const errorToSend = gatewayError || { code: "UNAVAILABLE", message: "History unavailable" };
      sendJson(ws, { type: "chat-history-result", sessionKey, messages: [], error: errorToSend });
      logHistory("fallback-fail", {
        sessionKey,
        correlationId,
        fallbackReason: gatewayError?.reason || "unknown",
        fallbackError: fallbackErr.message,
      });
    }
  },

  "chat-abort": async (msg, { ws, gatewayWS }) => {
    const { sessionKey, runId } = msg;
    if (!isCanonicalSessionKey(sessionKey)) {
      sendJson(ws, {
        type: "chat-abort-result",
        ok: false,
        error: { code: "INVALID_SESSION_KEY", message: "canonical sessionKey required" },
      });
      return;
    }

    if (!gatewayWS || !gatewayWS.connected) {
      sendJson(ws, {
        type: "chat-abort-result",
        ok: false,
        error: { code: "UNAVAILABLE", message: "Gateway not connected" },
      });
      return;
    }

    try {
      const result = await gatewayWS.request("chat.abort", { sessionKey, ...(runId && { runId }) });
      sendJson(ws, {
        type: "chat-abort-result",
        ok: true,
        aborted: result.aborted,
        runIds: result.runIds,
      });
    } catch (err) {
      sendJson(ws, { type: "chat-abort-result", ok: false, error: normalizeGatewayError(err) });
    }
  },

  "chat-new": async (msg, { ws }) => {
    const { model, agentId } = msg;
    const gwConfig = getGatewayConfig();
    if (!gwConfig.token) {
      sendJson(ws, { type: "chat-new-result", ok: false, error: "Gateway token not configured" });
      return;
    }

    try {
      const gwRes = await fetch(`http://127.0.0.1:${gwConfig.port}/tools/invoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${gwConfig.token}`,
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          tool: "sessions_spawn",
          args: {
            task: "New chat session from HUD",
            agentId: agentId || undefined,
            model: model || undefined,
            mode: "session",
            label: `hud-${Date.now()}`,
          },
        }),
      });
      const body = await gwRes.json();
      const sessionKey = body?.result?.details?.childSessionKey;
      if (sessionKey) {
        sendJson(ws, { type: "chat-new-result", ok: true, sessionKey });
      } else {
        sendJson(ws, {
          type: "chat-new-result",
          ok: false,
          error: body?.error?.message || "Unknown error",
        });
      }
    } catch (err) {
      sendJson(ws, { type: "chat-new-result", ok: false, error: err.message });
    }
  },

  "models-list": async (_msg, { ws, gatewayWS }) => {
    try {
      const result = await gatewayWS.request("models.list", {});
      sendJson(ws, { type: "models-list-result", models: result.models || result });
    } catch (err) {
      sendJson(ws, { type: "models-list-result", models: [], error: err.message });
    }
  },
};

async function handleChatMessage(ws, msg, gatewayWS) {
  return dispatchChatMessage(msg, commandHandlers, { ws, gatewayWS });
}

module.exports = {
  handleChatMessage,
  isChatMessage,
};
