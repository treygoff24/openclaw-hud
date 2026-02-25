const CANONICAL_SESSION_KEY_RE = /^agent:[a-zA-Z0-9_-]+:[a-zA-Z0-9:_-]+$/;

function isCanonicalSessionKey(sessionKey) {
  return typeof sessionKey === "string" && CANONICAL_SESSION_KEY_RE.test(sessionKey);
}

function parseCanonicalSessionKey(sessionKey) {
  const parts = sessionKey.split(":");
  if (parts.length < 3) return null;
  return {
    agentId: parts[1],
    storedKey: parts.slice(2).join(":"),
  };
}

module.exports = {
  CANONICAL_SESSION_KEY_RE,
  isCanonicalSessionKey,
  parseCanonicalSessionKey,
};
