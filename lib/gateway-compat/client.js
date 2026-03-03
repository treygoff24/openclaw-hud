const { GatewayWS } = require("../gateway-ws");
const { getGatewayConfig } = require("../helpers");
const { getGatewayHost, normalizeLoopbackDialHost, formatHostForUrl } = require("../gateway-http");

const DEFAULT_CONNECT_SCOPES = Object.freeze(["operator.read"]);
const METHOD_SCOPE_MAP = Object.freeze({
  "cron.list": ["operator.read"],
  "cron.add": ["operator.admin"],
  "cron.update": ["operator.admin"],
  "cron.remove": ["operator.admin"],
  "chat.history": ["operator.read"],
  "chat.send": ["operator.write"],
  "chat.abort": ["operator.write"],
  "models.list": ["operator.read"],
  "sessions.usage": ["operator.read"],
  "sessions_spawn": ["operator.write"],
  "usage.list": ["operator.read"],
});

function normalizeScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) return [...DEFAULT_CONNECT_SCOPES];
  const unique = [];
  const seen = new Set();
  for (const scope of scopes) {
    if (typeof scope !== "string") continue;
    const trimmed = scope.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    unique.push(trimmed);
    seen.add(trimmed);
  }
  return unique.length > 0 ? unique : [...DEFAULT_CONNECT_SCOPES];
}

function resolveMethodScopes(method, methodScopeMap = METHOD_SCOPE_MAP) {
  if (typeof method !== "string") return [...DEFAULT_CONNECT_SCOPES];
  if (!methodScopeMap || typeof methodScopeMap !== "object") return [...DEFAULT_CONNECT_SCOPES];
  const scoped = methodScopeMap[method];
  if (!Array.isArray(scoped)) return [...DEFAULT_CONNECT_SCOPES];
  return normalizeScopes(scoped);
}

function resolveGatewayWsUrl(gatewayConfig = {}) {
  const host = normalizeLoopbackDialHost(
    getGatewayHost({
      host: gatewayConfig.host,
      bind: gatewayConfig.bind,
    }),
  );
  const port = Number.isFinite(Number(gatewayConfig.port)) && Number(gatewayConfig.port) > 0
    ? Number(gatewayConfig.port)
    : 18789;
  return `ws://${formatHostForUrl(host)}:${port}`;
}

function resolveGatewayToken(gatewayConfig = {}) {
  const token = gatewayConfig && gatewayConfig.token;
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Gateway token not configured");
  }
  return token.trim();
}

function createGatewayClient({
  method,
  params = {},
  clientOptions = {},
  gatewayConfig,
  methodScopeMap,
  connectScopes,
  wsUrl,
  GatewayWSClass = GatewayWS,
}) {
  const config = gatewayConfig || getGatewayConfig();
  const scopes = normalizeScopes(
    connectScopes || resolveMethodScopes(method, methodScopeMap),
  );
  const url = wsUrl || resolveGatewayWsUrl(config);
  const token = clientOptions.token ?? resolveGatewayToken(config);

  return new GatewayWSClass({
    url,
    token,
    requestTimeoutMs: clientOptions.requestTimeoutMs,
    reconnect: clientOptions.reconnect || { enabled: false },
    connect: {
      scopes,
      role: clientOptions.role,
      locale: clientOptions.locale,
      userAgent: clientOptions.userAgent,
    },
  });
}

async function callGatewayMethod(method, params = {}, options = {}) {
  if (typeof method !== "string" || !method.trim()) {
    throw new Error("method is required");
  }
  const {
    client,
    gatewayClient,
    connectScopes,
    methodScopeMap,
    wsUrl,
    clientOptions = {},
    gatewayConfig,
    autoClose = true,
  } = options || {};
  const effectiveClient = gatewayClient || client || createGatewayClient({
    method,
    params,
    clientOptions,
    methodScopeMap,
    connectScopes,
    wsUrl,
    gatewayConfig,
    GatewayWSClass: options.GatewayWSClass,
  });
  const shouldClose = autoClose && !gatewayClient && !client;

  try {
    if (!effectiveClient.connected) {
      await effectiveClient.connect();
    }
    return await effectiveClient.request(method, params);
  } finally {
    if (shouldClose && typeof effectiveClient.close === "function") {
      effectiveClient.close();
    }
  }
}

module.exports = {
  callGatewayMethod,
  createGatewayClient,
  resolveMethodScopes,
  resolveGatewayWsUrl,
  resolveGatewayToken,
  DEFAULT_CONNECT_SCOPES,
  METHOD_SCOPE_MAP,
};
