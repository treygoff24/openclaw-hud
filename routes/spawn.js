const fs = require("fs");
const path = require("path");
const os = require("os");
const express = require("express");
const { Router } = require("express");
const { getGatewayConfig } = require("../lib/helpers");
const { resolveGatewayInvokeBaseUrl } = require("../lib/gateway-http");
const { createRequireLocalOrigin } = require("../lib/gateway-compat/origin-policy");
const { mapGatewayError } = require("../lib/gateway-compat/error-map");

const router = Router();

// Rate limiter — in-memory, resets on server restart (intentional for single-user local use)
const spawnTimestamps = [];
const MAX_SPAWNS_PER_MINUTE = 5;

const ALLOWED_ROOTS = [
  path.join(os.homedir(), "Development"),
  path.join(os.homedir(), ".openclaw"),
  path.join(os.homedir(), "Dropbox"),
];

const DEFAULT_SPAWN_PREFLIGHT = {
  ok: false,
  enabled: false,
  code: "SPAWN_PRECHECK_PENDING",
  status: "blocked",
  reason: "Spawn preflight is in progress. Start has not completed successfully.",
  diagnostics: [],
  checkedAt: null,
  source: "route-default",
};

let spawnPreflightState = Object.assign({}, DEFAULT_SPAWN_PREFLIGHT);

function cloneDiagnostics(diagnostics) {
  return Array.isArray(diagnostics) ? diagnostics.map((d) => Object.assign({}, d)) : [];
}

function normalizeSpawnPreflightState(nextState = {}) {
  const base = Object.assign({}, DEFAULT_SPAWN_PREFLIGHT, nextState);
  const diagnostics = cloneDiagnostics(base.diagnostics);
  return {
    ok: Boolean(base.ok),
    enabled: Boolean(base.ok && base.enabled),
    code:
      typeof base.code === "string" && base.code.trim()
        ? base.code.trim()
        : base.ok
          ? "READY"
          : "SPAWN_PRECHECK_FAILED",
    status:
      typeof base.status === "string" && base.status.trim()
        ? base.status.trim()
        : base.ok
          ? "ready"
          : "blocked",
    reason:
      typeof base.reason === "string" && base.reason.trim()
        ? base.reason.trim()
        : base.ok
          ? "spawn preflight passed"
          : "spawn preflight blocked",
    diagnostics,
    checkedAt:
      typeof base.checkedAt === "number" && Number.isFinite(base.checkedAt)
        ? base.checkedAt
        : Date.now(),
    source: typeof base.source === "string" && base.source.trim() ? base.source.trim() : "server",
  };
}

function getSpawnPreflightState() {
  return normalizeSpawnPreflightState(spawnPreflightState);
}

function setSpawnPreflightState(nextState) {
  spawnPreflightState = normalizeSpawnPreflightState(nextState);
}

const requireLocalOrigin = createRequireLocalOrigin();

function validateContextFiles(filesText) {
  const files = filesText
    .trim()
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
  if (files.length > 20) return { error: "Max 20 context files" };
  for (const f of files) {
    const resolved = path.resolve(f.replace(/^~/, os.homedir()));
    if (!ALLOWED_ROOTS.some((root) => resolved.startsWith(root + path.sep) || resolved === root)) {
      return { error: `File not in allowed directory: ${f}` };
    }
    try {
      const real = fs.realpathSync(resolved);
      if (!ALLOWED_ROOTS.some((root) => real.startsWith(root + path.sep) || real === root)) {
        return { error: `Path escapes allowed directory via symlink: ${f}` };
      }
    } catch (err) {
      if (err.code !== "ENOENT") return { error: `Cannot resolve path: ${f}` };
    }
  }
  return { valid: files };
}

function extractGatewayBodyText(response) {
  if (!response || typeof response.text !== "function") {
    return "";
  }

  return response
    .text()
    .then((value) => {
      if (typeof value === "string") return value;
      return "";
    })
    .catch(() => "");
}

function parseGatewayBodyFromText(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function resolveGatewayErrorPayload(gwRes, parsedBody, responseText) {
  const parsedError = parsedBody?.error;
  const rawCode =
    parsedBody && typeof parsedBody.code === "string"
      ? parsedBody.code
      : parsedError && typeof parsedError.code === "string"
        ? parsedError.code
        : undefined;
  const rawStatus =
    typeof parsedBody?.status === "number" && Number.isFinite(parsedBody.status)
      ? parsedBody.status
      : typeof parsedError?.status === "number" && Number.isFinite(parsedError.status)
        ? parsedError.status
        : typeof parsedBody?.status === "string" && Number.isFinite(Number(parsedBody.status))
          ? Number(parsedBody.status)
          : typeof parsedError?.status === "string" && Number.isFinite(Number(parsedError.status))
            ? Number(parsedError.status)
            : gwRes.status;
  const rawMessage =
    (parsedError && (typeof parsedError.message === "string" ? parsedError.message : undefined)) ||
    (typeof parsedError === "string" ? parsedError : undefined) ||
    (typeof parsedBody?.message === "string" ? parsedBody.message : undefined) ||
    responseText ||
    `HTTP ${rawStatus}`;

  return {
    code: rawCode,
    message: rawMessage,
    status: rawStatus,
  };
}

function resolveGatewaySuccessPayload(parsedBody) {
  if (!parsedBody || typeof parsedBody !== "object") return {};
  if (parsedBody?.result?.details) return parsedBody.result.details;
  if (parsedBody?.details) return parsedBody.details;
  if (parsedBody?.result && typeof parsedBody.result === "object") return parsedBody.result;
  return parsedBody;
}

function normalizeSpawnIdentifier(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed ? trimmed : "";
}

function extractSpawnIdentifiers(details = {}) {
  const sessionKey = normalizeSpawnIdentifier(
    details.childSessionKey ||
      details.childSession ||
      details.sessionKey ||
      details.child_session_key ||
      details.session_id,
  );
  const runId = normalizeSpawnIdentifier(details.runId || details.run_id);
  return { sessionKey, runId };
}

function writeCompatibilityErrorResponse(res, errorDetails, fallbackMessage) {
  const mapped = mapGatewayError(errorDetails);
  return res.status(mapped.status).json({
    error: mapped.message || fallbackMessage,
    code: mapped.code,
    reason: mapped.reason,
    status: mapped.status,
    ...(mapped.rawCode ? { rawCode: mapped.rawCode } : {}),
    ...(mapped.rawStatus !== undefined ? { rawStatus: mapped.rawStatus } : {}),
  });
}

// Cached model list for resolving aliases
let cachedModels = [];

function resolveAliasFromModel(modelId, modelList) {
  if (!modelId || !modelList) return undefined;
  const entry = modelList.find(
    (m) => m.id === modelId || m.model === modelId || m.fullId === modelId,
  );
  return entry?.alias || entry?.name || undefined;
}

function failFastSpawnUnavailable(res, state) {
  const diagnostics = cloneDiagnostics(state.diagnostics);
  return res.status(503).json({
    ok: false,
    enabled: false,
    code: state.code,
    status: state.status,
    error: state.reason,
    diagnostics,
  });
}

router.get("/api/spawn-preflight", (_req, res) => {
  const state = getSpawnPreflightState();
  res.json(state);
});

router.post("/api/spawn", requireLocalOrigin, express.json(), async (req, res) => {
  const preflight = getSpawnPreflightState();
  if (!preflight.ok || !preflight.enabled) {
    return failFastSpawnUnavailable(res, preflight);
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const { agentId, model, prompt, contextFiles, timeout } = body;
  const mode = body.mode === "session" ? "session" : "run";

  // Resolve label from model alias if no label provided (sanitized for valid label format)
  const resolvedAlias = resolveAliasFromModel(model, cachedModels);
  const sanitizedAlias = resolvedAlias && resolvedAlias.replace(/[^a-zA-Z0-9_-]/g, "_");
  const label = body.label || sanitizedAlias || undefined;

  // Rate limit
  const now = Date.now();
  while (spawnTimestamps.length && spawnTimestamps[0] < now - 60000) spawnTimestamps.shift();
  if (spawnTimestamps.length >= MAX_SPAWNS_PER_MINUTE) {
    return res.status(429).json({ error: "Rate limit: max 5 spawns per minute" });
  }

  // Validate
  if (prompt === undefined) return res.status(400).json({ error: "Prompt is required" });
  if (typeof prompt !== "string") return res.status(400).json({ error: "Prompt must be a string" });
  if (!prompt.trim()) return res.status(400).json({ error: "Prompt is required" });
  if (prompt.length > 50000)
    return res.status(400).json({ error: "Prompt too long (max 50,000 chars)" });
  if (!agentId) return res.status(400).json({ error: "Agent is required" });
  if (label && !/^[a-zA-Z0-9_-]{1,64}$/.test(label))
    return res
      .status(400)
      .json({ error: "Invalid label: alphanumeric, hyphens, underscores only (max 64 chars)" });
  if (timeout != null && (timeout < 0 || timeout > 7200))
    return res.status(400).json({ error: "Timeout must be 0-7200 seconds" });
  if (contextFiles !== undefined && typeof contextFiles !== "string")
    return res.status(400).json({ error: "ContextFiles must be a string" });

  // Build task prompt
  let task = prompt.trim();
  if (contextFiles?.trim()) {
    const result = validateContextFiles(contextFiles);
    if (result.error) return res.status(400).json({ error: result.error });
    task = `## Context Files\nRead these files first for context:\n${result.valid.map((f) => `- \`${f}\``).join("\n")}\n\n## Task\n${task}`;
  }

  // Gateway config
  const gw = getGatewayConfig();
  if (!gw.token) return res.status(500).json({ error: "Gateway token not configured" });
  let gatewayInvokeBaseUrl;
  try {
    gatewayInvokeBaseUrl = resolveGatewayInvokeBaseUrl(gw);
  } catch (err) {
    if (err?.code === "GATEWAY_HOST_UNSUPPORTED") {
      return res.status(502).json({ error: err.message, code: err.code });
    }
    throw err;
  }

  spawnTimestamps.push(Date.now());

  try {
    const gwRes = await fetch(`${gatewayInvokeBaseUrl}/tools/invoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gw.token}`,
      },
      body: JSON.stringify({
        tool: "sessions_spawn",
        args: {
          agentId,
          task,
          mode,
          ...(model && { model }),
          ...(label && { label }),
          ...(timeout != null && timeout > 0 && { runTimeoutSeconds: timeout }),
        },
      }),
    });

    let bodyText = await extractGatewayBodyText(gwRes);
    let parsedBody = bodyText ? parseGatewayBodyFromText(bodyText) : null;

    if (!parsedBody && typeof gwRes.json === "function") {
      try {
        parsedBody = await gwRes.json();
      } catch {
        // Ignore fallback parsing failures; we already have text fallback.
      }
    }

    if (!gwRes.ok) {
      const payload = resolveGatewayErrorPayload(gwRes, parsedBody, bodyText);
      return writeCompatibilityErrorResponse(
        res,
        payload,
        `Gateway request failed${bodyText ? `: ${bodyText}` : ""}`,
      );
    }

    const result = resolveGatewaySuccessPayload(parsedBody);
    console.log("[spawn] Gateway response:", JSON.stringify(parsedBody || result).slice(0, 500));

    const details = result || {};
    const { sessionKey, runId } = extractSpawnIdentifiers(details);
    if (!sessionKey && !runId) {
      return writeCompatibilityErrorResponse(
        res,
        {
          code: "SPAWN_RESPONSE_INVALID",
          message: "Gateway spawn response missing session/run identifiers.",
        },
        "Gateway returned a spawn response without usable session/run identifiers.",
      );
    }

    res.json({
      ok: true,
      sessionKey: sessionKey || null,
      runId: runId || null,
    });
  } catch (err) {
    return writeCompatibilityErrorResponse(
      res,
      { message: err.message, code: err.code, status: 502 },
      err.message,
    );
  }
});

// Export router and cachedModels for external updates
module.exports = router;
module.exports.cachedModels = cachedModels;
module.exports.setCachedModels = (models) => {
  cachedModels = models;
};
module.exports.getSpawnPreflightState = getSpawnPreflightState;
module.exports.setSpawnPreflightState = setSpawnPreflightState;
