function normalizeAddress(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isLoopbackHostname(hostname) {
  const normalized = normalizeAddress(hostname).replace(/^\[/, "").replace(/\]$/, "");
  if (!normalized) return false;
  if (normalized === "localhost" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1")
    return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(normalized)) return true;
  return false;
}

function isLoopbackRemoteAddress(address) {
  const normalized = normalizeAddress(address);
  if (!normalized) return false;
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (normalized.startsWith("::ffff:")) {
    return /^::ffff:127(?:\.\d{1,3}){3}$/.test(normalized);
  }
  return /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function isLoopbackOrigin(origin) {
  if (typeof origin !== "string" || !origin.trim()) return false;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return isLoopbackHostname(parsed.hostname);
}

function extractAuthTokenFromRequest(req) {
  const headerToken =
    typeof req?.headers?.["x-hud-ws-auth"] === "string" ? req.headers["x-hud-ws-auth"].trim() : "";
  if (headerToken) return headerToken;
  return "";
}

function validateWsUpgradeRequest(req, options = {}) {
  const expectedAuthToken =
    typeof options.authToken === "string" && options.authToken.trim()
      ? options.authToken.trim()
      : "";
  const origin = typeof req?.headers?.origin === "string" ? req.headers.origin : "";
  const remoteAddress = req?.socket?.remoteAddress || "";
  const isRemoteLoopback = isLoopbackRemoteAddress(remoteAddress);

  if (isLoopbackOrigin(origin) && isRemoteLoopback) {
    return { ok: true, reason: "origin-loopback" };
  }

  if (!origin && isRemoteLoopback) {
    return { ok: true, reason: "loopback-no-origin" };
  }

  if (expectedAuthToken) {
    const providedToken = extractAuthTokenFromRequest(req);
    if (providedToken && providedToken === expectedAuthToken) {
      return { ok: true, reason: "auth-token" };
    }
  }

  return { ok: false, statusCode: 403, message: "Forbidden websocket origin" };
}

module.exports = {
  isLoopbackHostname,
  isLoopbackRemoteAddress,
  isLoopbackOrigin,
  extractAuthTokenFromRequest,
  validateWsUpgradeRequest,
};
