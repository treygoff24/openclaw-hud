const path = require("path");
const fs = require("fs");
const { OPENCLAW_HOME, safeJSON, safeRead } = require("../../lib/helpers");
const { parseCanonicalSessionKey } = require("./session-key");
const {
  normalizeGatewayError: normalizeCompatGatewayError,
} = require("../../lib/gateway-compat/error-map");

const CHAT_HISTORY_LOG_PREFIX = "[CHAT-HISTORY]";
const SESSION_NOT_FOUND_CODES = new Set([
  "INVALID_SESSION_KEY",
  "SESSION_NOT_FOUND",
  "UNKNOWN_SESSION_KEY",
]);
const AUTH_SCOPE_CODES = new Set([
  "INVALID_SCOPE",
  "MISSING_SCOPE",
  "AUTH_SCOPE_MISSING",
  "INSUFFICIENT_SCOPE",
]);

function normalizeHistoryLimit(limit) {
  if (limit === undefined || limit === null || limit === "") return null;
  const parsed = Number(limit);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function logHistory(event, fields = {}) {
  const parts = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    parts.push(`${key}=${formatHistoryFieldValue(value)}`);
  }
  console.log(`${CHAT_HISTORY_LOG_PREFIX} ${event}${parts.length ? ` ${parts.join(" ")}` : ""}`);
}

function formatHistoryFieldValue(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
    return String(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "[function]";
  if (value === null) return "null";
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function toMessageContent(content) {
  if (Array.isArray(content)) return content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (content === undefined || content === null) return [];
  return [{ type: "text", text: String(content) }];
}

function mapLocalHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") return null;

  const timestamp =
    typeof entry.timestamp === "string" || typeof entry.timestamp === "number"
      ? entry.timestamp
      : undefined;

  if (entry.type === "tool_use") {
    return {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: entry.id || "",
          name: entry.name || "tool",
          input:
            entry.input !== undefined
              ? entry.input
              : entry.content !== undefined
                ? entry.content
                : "",
        },
      ],
      ...(timestamp ? { timestamp } : {}),
    };
  }

  if (entry.type === "tool_result") {
    return {
      role: "tool",
      content: [
        {
          type: "tool_result",
          tool_use_id: entry.tool_use_id || "",
          content: entry.content !== undefined ? entry.content : "",
        },
      ],
      ...(timestamp ? { timestamp } : {}),
    };
  }

  if (entry.type === "thinking") {
    return {
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: entry.thinking || entry.content || "",
        },
      ],
      ...(timestamp ? { timestamp } : {}),
    };
  }

  const role =
    typeof entry.role === "string"
      ? entry.role
      : entry.message && typeof entry.message.role === "string"
        ? entry.message.role
        : "system";
  const rawContent =
    entry.content !== undefined ? entry.content : entry.message ? entry.message.content : "";

  return {
    role,
    content: toMessageContent(rawContent),
    ...(timestamp ? { timestamp } : {}),
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadSessionLogRaw(sessionsDir, sessionId) {
  const exactPath = path.join(sessionsDir, `${sessionId}.jsonl`);
  if (fs.existsSync(exactPath)) {
    const raw = safeRead(exactPath);
    if (raw !== null && raw !== undefined) return raw;
  }

  let dirEntries = [];
  try {
    dirEntries = fs.readdirSync(sessionsDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidatePattern = new RegExp(`^${escapeRegExp(sessionId)}(?:$|[-_]).*\\.jsonl$`);
  let bestCandidate = null;
  let bestMtime = -Infinity;

  for (const entry of dirEntries) {
    if (!entry.isFile() || !candidatePattern.test(entry.name)) continue;
    const filePath = path.join(sessionsDir, entry.name);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    const mtimeMs = Number(stat.mtimeMs) || 0;
    if (!bestCandidate || mtimeMs > bestMtime) {
      bestCandidate = filePath;
      bestMtime = mtimeMs;
    }
  }

  if (!bestCandidate) return null;
  const raw = safeRead(bestCandidate);
  return raw !== null && raw !== undefined ? raw : null;
}

function loadLocalHistory(sessionKey, requestedLimit) {
  const parsed = parseCanonicalSessionKey(sessionKey);
  if (!parsed) throw new Error("Could not parse canonical session key");

  const { agentId, storedKey } = parsed;
  const sessionsDir = path.join(OPENCLAW_HOME, "agents", agentId, "sessions");
  const sessionsFile = path.join(sessionsDir, "sessions.json");
  const sessions = safeJSON(sessionsFile);
  if (!sessions || typeof sessions !== "object") {
    throw new Error("sessions.json not found");
  }

  const canonicalStoredKey = `agent:${agentId}:${storedKey}`;
  const sessionMeta = sessions[storedKey] || sessions[canonicalStoredKey];
  if (
    !sessionMeta ||
    typeof sessionMeta !== "object" ||
    typeof sessionMeta.sessionId !== "string" ||
    !sessionMeta.sessionId
  ) {
    throw new Error("Session not found in sessions.json");
  }

  const raw = loadSessionLogRaw(sessionsDir, sessionMeta.sessionId);
  if (raw === null) return [];

  const limit = normalizeHistoryLimit(requestedLimit);

  if (limit) {
    const messages = [];
    const lines = raw.split("\n");
    for (let i = lines.length - 1; i >= 0 && messages.length < limit; i--) {
      const line = lines[i];
      if (!line.trim()) continue;
      let parsedLine;
      try {
        parsedLine = JSON.parse(line);
      } catch {
        continue;
      }
      const mapped = mapLocalHistoryEntry(parsedLine);
      if (mapped) messages.unshift(mapped);
    }
    return messages;
  }

  const messages = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let parsedLine;
    try {
      parsedLine = JSON.parse(line);
    } catch {
      continue;
    }
    const mapped = mapLocalHistoryEntry(parsedLine);
    if (mapped) messages.push(mapped);
  }

  return messages;
}

function normalizeGatewayError(err) {
  const normalized = normalizeCompatGatewayError(err);
  const normalizedCode = String(normalized.code || "");
  const rawCode = String(normalized.rawCode || "").toUpperCase();
  const rawMessage = String(normalized.message || "Unknown error");
  const reason = normalizeChatHistoryReason(normalized.reason, rawCode, rawMessage);
  const code = normalizeChatHistoryCode(reason, normalizedCode, rawCode);

  return {
    code,
    status: normalized.status,
    reason,
    message: rawMessage,
    rawMessage,
    ...(normalized.rawCode ? { rawCode } : {}),
    ...(normalized.rawStatus !== undefined ? { rawStatus: normalized.rawStatus } : {}),
  };
}

function classifyChatHistoryGatewayError(err) {
  const normalized = normalizeCompatGatewayError(err);
  return normalizeChatHistoryReason(
    normalized.reason,
    String(normalized.rawCode || ""),
    normalized.message,
  );
}

function adaptChatHistoryGatewayError(err) {
  return {
    ...normalizeGatewayError(err),
    ...(err && typeof err.name === "string" ? { rawName: err.name } : {}),
  };
}

function isChatHistoryFallbackEligible(error) {
  const reason = error && typeof error.reason === "string" ? error.reason : "unknown";
  return (
    reason === "forbidden" ||
    reason === "missing_scope" ||
    reason === "not_found" ||
    reason === "network_unreachable" ||
    reason === "timeout"
  );
}

function normalizeChatHistoryReason(reason, rawCode, message) {
  const reasonUpper = String(reason || "").toLowerCase();
  const codeUpper = String(rawCode || "").toUpperCase();
  const messageLower = String(message || "").toLowerCase();

  if (
    codeUpper === "NOT_FOUND" ||
    SESSION_NOT_FOUND_CODES.has(codeUpper) ||
    /unknown session|session.*not found|invalid session key/i.test(messageLower)
  ) {
    return "not_found";
  }

  if (
    AUTH_SCOPE_CODES.has(codeUpper) ||
    /missing scope|scope.*missing|insufficient scope/i.test(messageLower)
  ) {
    return "missing_scope";
  }

  return reasonUpper;
}

function normalizeChatHistoryCode(reason, compatCode, rawCode) {
  if (reason === "not_found") return "UNKNOWN_SESSION_KEY";
  if (reason === "missing_scope" || reason === "forbidden") return "FORBIDDEN";
  if (!compatCode) {
    if (reason === "timeout") return "UNAVAILABLE";
    if (reason === "network_unreachable") return "UNAVAILABLE";
    return "GATEWAY_ERROR";
  }
  return compatCode;
}

module.exports = {
  normalizeHistoryLimit,
  logHistory,
  loadLocalHistory,
  normalizeGatewayError,
  classifyChatHistoryGatewayError,
  adaptChatHistoryGatewayError,
  isChatHistoryFallbackEligible,
};
