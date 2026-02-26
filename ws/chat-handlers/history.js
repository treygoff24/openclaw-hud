const path = require("path");
const fs = require("fs");
const { OPENCLAW_HOME, safeJSON, safeRead } = require("../../lib/helpers");
const { parseCanonicalSessionKey } = require("./session-key");

const CHAT_HISTORY_LOG_PREFIX = "[CHAT-HISTORY]";

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
  const message = err && err.message ? err.message : "Unknown error";
  const rawCode = err && typeof err.code === "string" ? err.code : "";
  if (
    rawCode === "INVALID_SESSION_KEY" ||
    rawCode === "SESSION_NOT_FOUND" ||
    /unknown session|session.*not found|invalid session key/i.test(message)
  ) {
    return { code: "UNKNOWN_SESSION_KEY", message };
  }
  if (
    rawCode === "FORBIDDEN" ||
    rawCode === "UNAUTHORIZED" ||
    /missing scope|permission|forbidden|unauthorized/i.test(message)
  ) {
    return { code: "FORBIDDEN", message };
  }
  return { code: rawCode || "UNKNOWN", message };
}

function toErrorMessage(err) {
  if (err && typeof err.message === "string" && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return "Unknown error";
}

function toErrorCode(err) {
  return err && typeof err.code === "string" ? err.code : "";
}

function toErrorStatus(err) {
  const candidates = [
    err && err.status,
    err && err.statusCode,
    err && err.response && err.response.status,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function classifyChatHistoryGatewayError(err) {
  const rawCode = toErrorCode(err);
  const message = toErrorMessage(err);
  const status = toErrorStatus(err);
  const codeUpper = rawCode.toUpperCase();
  const messageLower = message.toLowerCase();

  if (
    codeUpper === "MISSING_SCOPE" ||
    codeUpper === "AUTH_SCOPE_MISSING" ||
    codeUpper === "INSUFFICIENT_SCOPE" ||
    /missing scope|scope.*missing|insufficient scope|scope.*required|requires.*scope/i.test(
      messageLower,
    )
  ) {
    return "auth_scope_missing";
  }

  if (
    codeUpper === "INVALID_SESSION_KEY" ||
    codeUpper === "SESSION_NOT_FOUND" ||
    codeUpper === "UNKNOWN_SESSION_KEY" ||
    codeUpper === "NOT_FOUND" ||
    status === 404 ||
    /unknown session|session.*not found|invalid session key/i.test(messageLower)
  ) {
    return "not_found";
  }

  if (
    codeUpper === "FORBIDDEN" ||
    codeUpper === "UNAUTHORIZED" ||
    codeUpper === "PERMISSION_DENIED" ||
    status === 401 ||
    status === 403 ||
    /permission denied|forbidden|unauthorized|access denied/i.test(messageLower)
  ) {
    return "forbidden";
  }

  if (
    codeUpper === "ETIMEDOUT" ||
    codeUpper === "ESOCKETTIMEDOUT" ||
    codeUpper === "TIMEOUT" ||
    codeUpper === "ERR_TIMEOUT" ||
    codeUpper === "ABORT_ERR" ||
    codeUpper === "UND_ERR_CONNECT_TIMEOUT" ||
    codeUpper === "UND_ERR_HEADERS_TIMEOUT" ||
    codeUpper === "UND_ERR_BODY_TIMEOUT" ||
    status === 408 ||
    status === 504 ||
    /timeout|timed out|deadline exceeded|operation was aborted|aborterror/i.test(messageLower)
  ) {
    return "timeout";
  }

  if (
    codeUpper === "UNAVAILABLE" ||
    codeUpper === "ECONNRESET" ||
    codeUpper === "ECONNREFUSED" ||
    codeUpper === "EHOSTUNREACH" ||
    codeUpper === "ENETUNREACH" ||
    codeUpper === "ENOTFOUND" ||
    codeUpper === "EAI_AGAIN" ||
    codeUpper === "ERR_NETWORK" ||
    codeUpper === "NETWORK_ERROR" ||
    status === 429 ||
    (typeof status === "number" && status >= 500) ||
    /gateway not connected|service unavailable|temporarily unavailable|network error|socket hang up|connection reset|connection refused|fetch failed|bad gateway|gateway unavailable|econnreset|econnrefused|ehostunreach|enotfound|eai_again/i.test(
      messageLower,
    )
  ) {
    return "unavailable";
  }

  return "unknown";
}

function adaptChatHistoryGatewayError(err) {
  const rawCode = toErrorCode(err);
  const rawMessage = toErrorMessage(err);
  const rawStatus = toErrorStatus(err);
  const rawName = err && typeof err.name === "string" ? err.name : undefined;
  const reason = classifyChatHistoryGatewayError(err);

  let code = rawCode || "UNKNOWN";
  if (reason === "not_found") code = "UNKNOWN_SESSION_KEY";
  else if (reason === "forbidden" || reason === "auth_scope_missing") code = "FORBIDDEN";
  else if (!rawCode && reason === "unavailable") code = "UNAVAILABLE";
  else if (!rawCode && reason === "timeout") code = "TIMEOUT";

  return {
    code,
    message: rawMessage,
    reason,
    ...(rawCode ? { rawCode } : {}),
    rawMessage,
    ...(rawStatus !== undefined ? { rawStatus } : {}),
    ...(rawName ? { rawName } : {}),
  };
}

function isChatHistoryFallbackEligible(error) {
  const reason = error && typeof error.reason === "string" ? error.reason : "unknown";
  return (
    reason === "forbidden" ||
    reason === "auth_scope_missing" ||
    reason === "not_found" ||
    reason === "unavailable" ||
    reason === "timeout"
  );
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
