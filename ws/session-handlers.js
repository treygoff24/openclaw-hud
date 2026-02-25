const fs = require("fs");
const path = require("path");
const { OPENCLAW_HOME } = require("../lib/helpers");

const CANONICAL_SESSION_KEY_RE = /^agent:[a-zA-Z0-9_-]+:[a-zA-Z0-9:_-]+$/;
const VALID_THINKING_VALUES = ["on", "off", "extended"];

function isCanonicalSessionKey(sessionKey) {
  return typeof sessionKey === "string" && CANONICAL_SESSION_KEY_RE.test(sessionKey);
}

function parseSessionKey(sessionKey) {
  const parts = sessionKey.split(":");
  if (parts.length < 3) return null;
  return {
    agentId: parts[1],
    storedKey: parts.slice(2).join(":"),
  };
}

function getSessionsFilePath(agentId) {
  return path.join(OPENCLAW_HOME, "agents", agentId, "sessions", "sessions.json");
}

function validateUpdates(updates) {
  const { model, thinking, verbose } = updates;
  const hasUpdates = model !== undefined || thinking !== undefined || verbose !== undefined;

  if (!hasUpdates) {
    return {
      valid: false,
      error: {
        code: "NO_UPDATES",
        message: "At least one of model, thinking, or verbose must be provided",
      },
    };
  }

  if (thinking !== undefined && !VALID_THINKING_VALUES.includes(thinking)) {
    return {
      valid: false,
      error: {
        code: "INVALID_THINKING",
        message: `thinking must be one of: ${VALID_THINKING_VALUES.join(", ")}`,
      },
    };
  }

  if (verbose !== undefined && typeof verbose !== "boolean") {
    return {
      valid: false,
      error: { code: "INVALID_VERBOSE", message: "verbose must be a boolean" },
    };
  }

  return { valid: true };
}

async function handleSessionsPatch(ws, msg) {
  const { sessionKey, model, thinking, verbose } = msg;

  // Validate sessionKey
  if (!sessionKey) {
    ws.send(
      JSON.stringify({
        type: "error",
        error: { code: "INVALID_SESSION_KEY", message: "sessionKey is required" },
      }),
    );
    return;
  }

  if (!isCanonicalSessionKey(sessionKey)) {
    ws.send(
      JSON.stringify({
        type: "error",
        error: { code: "INVALID_SESSION_KEY", message: "Invalid sessionKey format" },
      }),
    );
    return;
  }

  // Validate updates
  const validation = validateUpdates({ model, thinking, verbose });
  if (!validation.valid) {
    ws.send(JSON.stringify({ type: "error", error: validation.error }));
    return;
  }

  // Parse session key to get agentId and stored key
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) {
    ws.send(
      JSON.stringify({
        type: "error",
        error: { code: "INVALID_SESSION_KEY", message: "Could not parse sessionKey" },
      }),
    );
    return;
  }

  const { agentId, storedKey } = parsed;
  const sessionsFilePath = getSessionsFilePath(agentId);

  try {
    // Check if file exists
    if (!fs.existsSync(sessionsFilePath)) {
      ws.send(
        JSON.stringify({
          type: "error",
          error: { code: "SESSION_NOT_FOUND", message: "Session file not found" },
        }),
      );
      return;
    }

    // Read and parse sessions file
    let sessions;
    try {
      const fileContent = fs.readFileSync(sessionsFilePath, "utf-8");
      sessions = JSON.parse(fileContent);
    } catch (err) {
      ws.send(
        JSON.stringify({
          type: "error",
          error: { code: "INTERNAL_ERROR", message: "Failed to read or parse sessions file" },
        }),
      );
      return;
    }

    // Check if session exists
    if (!sessions[storedKey]) {
      ws.send(
        JSON.stringify({
          type: "error",
          error: { code: "SESSION_NOT_FOUND", message: "Session not found in sessions file" },
        }),
      );
      return;
    }

    // Apply updates
    const session = sessions[storedKey];
    const updatedSettings = {};

    if (model !== undefined) {
      session.model = model;
      updatedSettings.model = model;
    }

    if (thinking !== undefined) {
      session.thinking = thinking;
      updatedSettings.thinking = thinking;
    }

    if (verbose !== undefined) {
      session.verbose = verbose;
      updatedSettings.verbose = verbose;
    }

    // Update timestamp
    session.updatedAt = Date.now();

    // Write back to file
    try {
      fs.writeFileSync(sessionsFilePath, JSON.stringify(sessions, null, 2));
    } catch (err) {
      ws.send(
        JSON.stringify({
          type: "error",
          error: { code: "INTERNAL_ERROR", message: "Failed to write sessions file" },
        }),
      );
      return;
    }

    // Send success response
    ws.send(
      JSON.stringify({
        type: "sessions.patched",
        sessionKey,
        ...updatedSettings,
        updatedAt: session.updatedAt,
      }),
    );
  } catch (err) {
    ws.send(
      JSON.stringify({
        type: "error",
        error: { code: "INTERNAL_ERROR", message: err.message || "Unknown error" },
      }),
    );
  }
}

async function handleSessionMessage(ws, msg) {
  switch (msg.type) {
    case "sessions.patch":
      await handleSessionsPatch(ws, msg);
      break;
    default:
      return false; // not handled
  }
  return true;
}

function isSessionMessage(type) {
  return type === "sessions.patch";
}

module.exports = {
  handleSessionMessage,
  isSessionMessage,
  // Exported for testing
  isCanonicalSessionKey,
  parseSessionKey,
  validateUpdates,
};
