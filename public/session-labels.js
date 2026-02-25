(function () {
  "use strict";

  const ROLE_MAIN = "main";
  const ROLE_SUBAGENT = "subagent";
  const ROLE_LABEL_MAP = {
    [ROLE_MAIN]: "Main",
    [ROLE_SUBAGENT]: "Subagent",
  };
  const SEPARATOR = " · ";
  const UNKNOWN_MODEL = "unknown model";
  const UNKNOWN_ALIAS = "session";

  function toText(value) {
    if (value == null) return "";
    return String(value).trim();
  }

  function firstNonEmpty(values) {
    for (const value of values) {
      const text = toText(value);
      if (text) return text;
    }
    return "";
  }

  function toCompactAlias(value) {
    return toText(value).replace(/\s+/g, " ");
  }

  function deriveSessionRole(session) {
    const spawnDepth = Number(session && session.spawnDepth);
    const hasSpawnedBy = toText(session && session.spawnedBy);
    const isSubagent = hasSpawnedBy || (Number.isFinite(spawnDepth) && spawnDepth > 0);
    return isSubagent ? ROLE_SUBAGENT : ROLE_MAIN;
  }

  function deriveModelLabel(session) {
    // Prefer backend-enriched modelLabel (already alias-resolved) over raw model ID
    const enriched = toText(session && session.modelLabel);
    if (enriched) return enriched;

    const rawModel = firstNonEmpty([
      session && session.model,
      session && session.modelName,
      session && session.activeModel,
      session && session.lastModel,
      session && session.preferredModel,
    ]);
    const normalized = toCompactAlias(rawModel);
    if (!normalized) return UNKNOWN_MODEL;
    const normalizedParts = normalized.split("/");
    return normalizedParts[normalizedParts.length - 1];
  }

  function deriveAliasFromKey(value) {
    const key = toText(value);
    if (!key) return "";
    return key.split(":").pop();
  }

  function deriveAlias(session) {
    const rawAlias = firstNonEmpty([
      session && session.sessionAlias,
      session && session.alias,
      session && session.label,
      deriveAliasFromKey(session && session.key),
      deriveAliasFromKey(session && session.sessionKey),
      session && session.sessionId,
    ]);
    const normalizedAlias = toCompactAlias(rawAlias);
    return normalizedAlias || UNKNOWN_ALIAS;
  }

  function deriveFullSlug(session) {
    const key = firstNonEmpty([session && session.sessionKey, session && session.key]);
    if (key) return key;
    if (session && session.agentId && session.sessionId) {
      return `agent:${session.agentId}:${session.sessionId}`;
    }
    return "";
  }

  function buildCompactLabel(sessionRole, modelLabel, sessionAlias) {
    const roleLabel = ROLE_LABEL_MAP[sessionRole] || ROLE_LABEL_MAP[ROLE_MAIN];
    return `${roleLabel}${SEPARATOR}${modelLabel}${SEPARATOR}${sessionAlias}`;
  }

  function getDisplayMeta(session) {
    const safeSession = session && typeof session === "object" ? session : {};
    const sessionRole = deriveSessionRole(safeSession);
    const modelLabel = deriveModelLabel(safeSession);
    const sessionAlias = deriveAlias(safeSession);
    const fullSlug = deriveFullSlug(safeSession);
    const compactLabel = buildCompactLabel(sessionRole, modelLabel, sessionAlias);

    return {
      sessionRole,
      roleLabel: ROLE_LABEL_MAP[sessionRole] || ROLE_LABEL_MAP[ROLE_MAIN],
      modelLabel,
      sessionAlias,
      fullSlug,
      compactLabel,
    };
  }

  function buildSessionAriaLabel(session, meta) {
    const safeSession = session && typeof session === "object" ? session : {};
    const data = meta || getDisplayMeta(safeSession);
    const roleLabel = data.roleLabel || ROLE_LABEL_MAP[ROLE_MAIN];
    const modelLabel = data.modelLabel || UNKNOWN_MODEL;
    const sessionAlias = data.sessionAlias || UNKNOWN_ALIAS;
    const fullSlug = data.fullSlug || deriveFullSlug(safeSession) || "unknown session";
    const agentId = toText(safeSession.agentId) || "unknown";
    const status = toText(safeSession.status) || "unknown";

    return `Session ${fullSlug}; role ${roleLabel}; model ${modelLabel}; alias ${sessionAlias}; agent ${agentId}; status ${status}`;
  }

  window.SessionLabels = {
    getDisplayMeta,
    buildSessionAriaLabel,
  };
})();
