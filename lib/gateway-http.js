function unwrapHost(host) {
  return String(host || "")
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .toLowerCase();
}

function getGatewayHost(gw = {}) {
  const raw =
    typeof gw.host === "string" && gw.host.trim()
      ? gw.host.trim()
      : typeof gw.bind === "string" && gw.bind.trim()
        ? gw.bind.trim()
        : "127.0.0.1";
  if (raw.toLowerCase() === "loopback") return "127.0.0.1";
  return raw;
}

function isLocalLoopbackHost(host) {
  const unwrapped = unwrapHost(host);
  if (!unwrapped) return false;
  if (unwrapped === "localhost" || unwrapped === "0.0.0.0" || unwrapped === "loopback") return true;
  if (unwrapped === "::1" || unwrapped === "0:0:0:0:0:0:0:1") return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(unwrapped)) return true;
  return false;
}

function normalizeLoopbackDialHost(host) {
  const unwrapped = unwrapHost(host);
  if (
    !unwrapped ||
    unwrapped === "localhost" ||
    unwrapped === "0.0.0.0" ||
    unwrapped === "loopback"
  )
    return "127.0.0.1";
  if (unwrapped === "0:0:0:0:0:0:0:1") return "::1";
  return unwrapped;
}

function formatHostForUrl(host) {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function createGatewayHostUnsupportedError(host) {
  const err = new Error(
    "Gateway host must be local/loopback for token-authenticated HTTP requests",
  );
  err.code = "GATEWAY_HOST_UNSUPPORTED";
  err.gatewayHost = host;
  return err;
}

function resolveGatewayInvokeBaseUrl(gw = {}) {
  const host = getGatewayHost(gw);
  if (!isLocalLoopbackHost(host)) {
    throw createGatewayHostUnsupportedError(host);
  }
  const dialHost = normalizeLoopbackDialHost(host);
  const port = gw.port || 18789;
  return `http://${formatHostForUrl(dialHost)}:${port}`;
}

module.exports = {
  getGatewayHost,
  isLocalLoopbackHost,
  normalizeLoopbackDialHost,
  formatHostForUrl,
  createGatewayHostUnsupportedError,
  resolveGatewayInvokeBaseUrl,
};
